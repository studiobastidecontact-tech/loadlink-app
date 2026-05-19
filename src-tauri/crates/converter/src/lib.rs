//! # loadlink-converter
//!
//! Video/audio/image/document conversion using FFmpeg (and LibreOffice for docs).
//!
//! Current capabilities:
//! - Reencode videos to H.265 (HEVC) with CRF or target bitrate modes (legacy)
//! - Convert files in batch with per-type options (Phase 3 — Convertir module)
//! - Probe video duration and bitrate for accurate target sizing
//! - Recursive directory scanning for batch operations
//!
//! Documents (DOCX/PDF/ODT/...) require LibreOffice headless to be installed.
//! If not present, the convert command returns a structured error so the UI
//! can prompt the user to install it.

use loadlink_core::{CompressProgress, CompressResult, LoadlinkError, Result};
use loadlink_workers::{apply_no_window, get_ffmpeg_path};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

// ============================================
// Legacy options (Compresser module - unchanged)
// ============================================

#[derive(Debug, Clone)]
pub struct ReencodeOptions {
    pub source: String,
    pub output_dir: Option<String>,
    pub mode: String,
    pub crf: i32,
    pub bitrate_ratio: f32,
}

// ============================================
// New: file kind detection (Phase 3 — Convertir)
// ============================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Video,
    Audio,
    Image,
    Document,
    Unknown,
}

impl FileKind {
    pub fn from_extension(ext: &str) -> Self {
        match ext.to_lowercase().as_str() {
            // Video
            "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" | "flv" | "wmv" | "mts" | "ts"
            | "3gp" | "ogv" | "mpg" | "mpeg" | "vob" => FileKind::Video,
            // Audio
            "mp3" | "wav" | "flac" | "m4a" | "ogg" | "aac" | "wma" | "opus" | "ac3" | "aiff"
            | "aif" => FileKind::Audio,
            // Image
            "jpg" | "jpeg" | "png" | "webp" | "avif" | "heic" | "heif" | "tiff" | "tif" | "bmp"
            | "gif" | "ico" => FileKind::Image,
            // Document (LibreOffice required)
            "docx" | "doc" | "odt" | "rtf" | "pdf" | "txt" | "html" | "htm" | "xlsx" | "xls"
            | "ods" | "csv" | "pptx" | "ppt" | "odp" | "epub" | "md" => FileKind::Document,
            _ => FileKind::Unknown,
        }
    }
}

pub fn detect_file_kind(path: &Path) -> FileKind {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        FileKind::from_extension(ext)
    } else {
        FileKind::Unknown
    }
}

// ============================================
// New: per-type conversion options
// ============================================

#[derive(Debug, Clone, Deserialize)]
pub struct VideoConvertOpts {
    /// Target extension (mp4, webm, mov, mkv, avi, gif)
    pub target_format: String,
    /// "auto" or codec name (h264, h265, vp9, av1)
    pub codec: String,
    /// "auto" or bitrate in kbps as string ("5000")
    pub bitrate: String,
    /// "auto" or resolution ("1920x1080", "1280x720", "3840x2160")
    pub resolution: String,
    /// "auto" or fps ("24", "30", "60")
    pub fps: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AudioConvertOpts {
    pub target_format: String, // mp3, wav, flac, m4a, ogg, aac, opus
    pub codec: String,         // "auto" or codec
    pub bitrate: String,       // "auto" or "128k", "192k", "320k"
    pub sample_rate: String,   // "auto" or "44100", "48000"
    pub channels: String,      // "auto", "1" (mono), "2" (stereo)
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImageConvertOpts {
    pub target_format: String, // jpg, png, webp, avif, tiff, bmp
    pub quality: String,       // "auto" or "1"-"100"
    pub resolution: String,    // "auto" or "1920x1080" / "1920" (max width)
}

#[derive(Debug, Clone, Deserialize)]
pub struct DocumentConvertOpts {
    pub target_format: String, // pdf, docx, odt, rtf, txt, html, etc.
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ConvertOpts {
    Video(VideoConvertOpts),
    Audio(AudioConvertOpts),
    Image(ImageConvertOpts),
    Document(DocumentConvertOpts),
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConvertFileEntry {
    pub source_path: String,
    pub opts: ConvertOpts,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConvertBatchOptions {
    pub files: Vec<ConvertFileEntry>,
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConvertResult {
    pub success: bool,
    pub output_path: String,
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub libreoffice_missing: bool,
    pub error: Option<String>,
}

// ============================================
// File helpers (existing — kept for compatibility)
// ============================================

pub fn is_video_file(path: &Path) -> bool {
    detect_file_kind(path) == FileKind::Video
}

pub fn collect_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if dir.is_file() {
        files.push(dir.to_path_buf());
        return files;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(collect_files(&path));
            } else {
                files.push(path);
            }
        }
    }
    files
}

// ============================================
// Video probing — existing (unchanged signature)
// ============================================

pub async fn probe_video_info(ffmpeg: &PathBuf, video: &Path) -> (f32, u64) {
    let mut cmd = Command::new(ffmpeg);
    cmd.arg("-i").arg(video);
    apply_no_window(&mut cmd);

    let output = match timeout(Duration::from_secs(10), cmd.output()).await {
        Ok(Ok(o)) => o,
        _ => return (0.0, 0),
    };
    let stderr = String::from_utf8_lossy(&output.stderr);

    let dur_re = regex::Regex::new(r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)").unwrap();
    let duration = if let Some(c) = dur_re.captures(&stderr) {
        let h: f32 = c[1].parse().unwrap_or(0.0);
        let m: f32 = c[2].parse().unwrap_or(0.0);
        let s: f32 = c[3].parse().unwrap_or(0.0);
        let cs: f32 = c[4].parse().unwrap_or(0.0);
        h * 3600.0 + m * 60.0 + s + cs / 100.0
    } else {
        0.0
    };

    let stream_bitrate_re =
        regex::Regex::new(r"Stream #\d+:\d+.*?Video:.*?(\d+)\s*kb/s").unwrap();
    if let Some(c) = stream_bitrate_re.captures(&stderr) {
        if let Ok(kbps) = c[1].parse::<u64>() {
            return (duration, kbps * 1000);
        }
    }

    let container_bitrate_re = regex::Regex::new(r"bitrate:\s*(\d+)\s*kb/s").unwrap();
    if let Some(c) = container_bitrate_re.captures(&stderr) {
        if let Ok(kbps) = c[1].parse::<u64>() {
            let video_estimate = kbps.saturating_sub(128);
            return (duration, video_estimate * 1000);
        }
    }

    if duration > 0.0 {
        if let Ok(meta) = std::fs::metadata(video) {
            let size_bits = meta.len() * 8;
            let estimated_bps = (size_bits as f32 / duration) as u64;
            return (duration, estimated_bps);
        }
    }

    (duration, 0)
}

// ============================================
// LEGACY: reencode_videos (Compresser module — unchanged)
// ============================================

pub async fn reencode_videos(app: &AppHandle, opts: ReencodeOptions) -> Result<CompressResult> {
    let ffmpeg = get_ffmpeg_path(app)?;
    let source_path = PathBuf::from(&opts.source);
    if !source_path.exists() {
        return Ok(CompressResult {
            success: false,
            output_path: String::new(),
            output_info: None,
            error: Some("Source introuvable".to_string()),
        });
    }

    let _ = app.emit(
        "compress-progress",
        CompressProgress {
            percent: 0.0,
            stage: "scanning".to_string(),
            current_file: None,
            file_index: None,
            total_files: None,
        },
    );

    let all_files = collect_files(&source_path);
    let videos: Vec<PathBuf> = all_files.into_iter().filter(|p| is_video_file(p)).collect();

    if videos.is_empty() {
        return Ok(CompressResult {
            success: false,
            output_path: String::new(),
            output_info: None,
            error: Some("Aucune vidéo trouvée dans ce dossier".to_string()),
        });
    }

    let folder_name = source_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "compressed".to_string());

    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| String::from("."));
    let out_root = opts
        .output_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(&user_profile)
                .join("Videos")
                .join("LoadLink-Videos")
        });

    let suffix = if opts.mode == "bitrate" {
        format!("-{}pct", (opts.bitrate_ratio * 100.0) as i32)
    } else {
        "-H265".to_string()
    };
    let target_root = out_root.join(format!("[COMPRESSED] {}{}", folder_name, suffix));
    std::fs::create_dir_all(&target_root)?;

    let base = if source_path.is_dir() {
        source_path.clone()
    } else {
        source_path
            .parent()
            .unwrap_or(Path::new("."))
            .to_path_buf()
    };

    let total = videos.len() as u32;
    let mut total_in: u64 = 0;
    let mut total_out: u64 = 0;

    for (i, video) in videos.iter().enumerate() {
        let rel = video.strip_prefix(&base).unwrap_or(video);
        let out_path = target_root.join(rel).with_extension("mp4");
        if let Some(p) = out_path.parent() {
            std::fs::create_dir_all(p).ok();
        }

        let name = rel.to_string_lossy().to_string();
        let (duration_secs, source_bitrate) = probe_video_info(&ffmpeg, video).await;

        let mut cmd = Command::new(&ffmpeg);
        cmd.arg("-hide_banner")
            .arg("-y")
            .arg("-i")
            .arg(video)
            .arg("-c:v")
            .arg("libx265")
            .arg("-preset")
            .arg("medium");

        if opts.mode == "bitrate" && source_bitrate > 0 {
            let target_kbps = ((source_bitrate as f32 / 1000.0) * opts.bitrate_ratio) as i32;
            let target_kbps = target_kbps.max(200);
            cmd.arg("-b:v")
                .arg(format!("{}k", target_kbps))
                .arg("-maxrate")
                .arg(format!("{}k", (target_kbps as f32 * 1.5) as i32))
                .arg("-bufsize")
                .arg(format!("{}k", target_kbps * 2));
        } else {
            cmd.arg("-crf").arg(opts.crf.to_string());
        }

        cmd.arg("-c:a")
            .arg("aac")
            .arg("-b:a")
            .arg("192k")
            .arg("-progress")
            .arg("pipe:1")
            .arg("-nostats")
            .arg(&out_path);

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        apply_no_window(&mut cmd);

        let mut child = cmd
            .spawn()
            .map_err(|e| LoadlinkError::SpawnFailed(format!("ffmpeg spawn: {}", e)))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| LoadlinkError::Other("no stdout".to_string()))?;

        let app_clone = app.clone();
        let name_clone = name.clone();
        let idx = i as u32 + 1;
        let dur = duration_secs;

        let stdout_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            let time_re = regex::Regex::new(r"out_time_ms=(\d+)").unwrap();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Some(c) = time_re.captures(&line) {
                    let us: f32 = c[1].parse().unwrap_or(0.0);
                    let processed = us / 1_000_000.0;
                    let percent = if dur > 0.0 {
                        (processed / dur * 100.0).min(99.0)
                    } else {
                        50.0
                    };
                    let _ = app_clone.emit(
                        "compress-progress",
                        CompressProgress {
                            percent,
                            stage: "reencoding".to_string(),
                            current_file: Some(name_clone.clone()),
                            file_index: Some(idx),
                            total_files: Some(total),
                        },
                    );
                }
            }
        });

        let status = child
            .wait()
            .await
            .map_err(|e| LoadlinkError::Other(e.to_string()))?;
        let _ = stdout_task.await;

        if !status.success() {
            continue;
        }

        total_in += std::fs::metadata(video).map(|m| m.len()).unwrap_or(0);
        total_out += std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
    }

    let saved_pct = if total_in > 0 {
        (1.0 - total_out as f64 / total_in as f64) * 100.0
    } else {
        0.0
    };
    let info = format!(
        "{} vidéos · {:.1} Mo → {:.1} Mo (-{:.0}%)",
        total,
        total_in as f64 / 1_048_576.0,
        total_out as f64 / 1_048_576.0,
        saved_pct.max(0.0)
    );

    Ok(CompressResult {
        success: true,
        output_path: target_root.to_string_lossy().to_string(),
        output_info: Some(info),
        error: None,
    })
}

// ============================================
// PHASE 3: Convert module — batch conversion
// ============================================

/// Default output dir: %USERPROFILE%\Videos\LoadLink-Converted
fn default_convert_output_dir() -> PathBuf {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| String::from("."));
    PathBuf::from(&user_profile)
        .join("Videos")
        .join("LoadLink-Converted")
}

/// Check if LibreOffice (soffice) is available in PATH or in common install locations.
pub fn find_libreoffice() -> Option<PathBuf> {
    // Common Windows install paths
    let candidates = [
        "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
        "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }
    // Try PATH
    if let Ok(output) = std::process::Command::new("where").arg("soffice").output() {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout);
            if let Some(first_line) = s.lines().next() {
                let p = PathBuf::from(first_line.trim());
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// Generate the output path for a converted file.
/// Source: C:\foo\bar.mov + target_ext: "mp4" + out_dir: F:\out
/// → F:\out\bar.mp4
fn make_output_path(source: &Path, target_ext: &str, out_dir: &Path) -> PathBuf {
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("converted");
    out_dir.join(format!("{}.{}", stem, target_ext))
}

/// Convert one video file via FFmpeg.
async fn convert_video(
    app: &AppHandle,
    ffmpeg: &PathBuf,
    source: &Path,
    out_path: &Path,
    opts: &VideoConvertOpts,
    file_index: u32,
    total_files: u32,
) -> std::result::Result<(), String> {
    let (duration_secs, _src_bitrate) = probe_video_info(ffmpeg, source).await;

    let mut cmd = Command::new(ffmpeg);
    cmd.arg("-hide_banner").arg("-y").arg("-i").arg(source);

    // Codec selection
    let codec_arg = match opts.codec.as_str() {
        "h264" => Some("libx264"),
        "h265" | "hevc" => Some("libx265"),
        "vp9" => Some("libvpx-vp9"),
        "av1" => Some("libaom-av1"),
        "auto" | "" => None,
        _ => None,
    };
    if let Some(c) = codec_arg {
        cmd.arg("-c:v").arg(c);
    }

    // Bitrate
    if opts.bitrate != "auto" && !opts.bitrate.is_empty() {
        let kbps_str = opts
            .bitrate
            .trim_end_matches('k')
            .trim_end_matches('K')
            .to_string();
        if let Ok(kbps) = kbps_str.parse::<i32>() {
            if kbps > 0 {
                cmd.arg("-b:v").arg(format!("{}k", kbps));
            }
        }
    }

    // Resolution (scale filter)
    if opts.resolution != "auto" && !opts.resolution.is_empty() {
        let scale = if opts.resolution.contains('x') {
            // "1920x1080" → use as is
            opts.resolution.replace('x', ":")
        } else {
            // "1920" → "1920:-2" (preserve aspect ratio)
            format!("{}:-2", opts.resolution)
        };
        cmd.arg("-vf").arg(format!("scale={}", scale));
    }

    // FPS
    if opts.fps != "auto" && !opts.fps.is_empty() {
        cmd.arg("-r").arg(&opts.fps);
    }

    // Audio: copy if no transcode needed, else convert to AAC 192k
    cmd.arg("-c:a").arg("aac").arg("-b:a").arg("192k");

    cmd.arg("-progress").arg("pipe:1").arg("-nostats");
    cmd.arg(out_path);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    apply_no_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("ffmpeg spawn: {}", e))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;

    let app_clone = app.clone();
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let dur = duration_secs;

    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let time_re = regex::Regex::new(r"out_time_ms=(\d+)").unwrap();
        while let Ok(Some(line)) = reader.next_line().await {
            if let Some(c) = time_re.captures(&line) {
                let us: f32 = c[1].parse().unwrap_or(0.0);
                let processed = us / 1_000_000.0;
                let percent = if dur > 0.0 {
                    (processed / dur * 100.0).min(99.0)
                } else {
                    50.0
                };
                let _ = app_clone.emit(
                    "convert-progress",
                    CompressProgress {
                        percent,
                        stage: "converting".to_string(),
                        current_file: Some(name.clone()),
                        file_index: Some(file_index),
                        total_files: Some(total_files),
                    },
                );
            }
        }
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = stdout_task.await;

    if !status.success() {
        return Err("ffmpeg a échoué".to_string());
    }
    Ok(())
}

/// Convert one audio file via FFmpeg.
async fn convert_audio(
    ffmpeg: &PathBuf,
    source: &Path,
    out_path: &Path,
    opts: &AudioConvertOpts,
) -> std::result::Result<(), String> {
    let mut cmd = Command::new(ffmpeg);
    cmd.arg("-hide_banner").arg("-y").arg("-i").arg(source);

    let codec_arg = match opts.codec.as_str() {
        "mp3" => Some("libmp3lame"),
        "aac" => Some("aac"),
        "flac" => Some("flac"),
        "opus" => Some("libopus"),
        "vorbis" => Some("libvorbis"),
        "wav" | "pcm" => Some("pcm_s16le"),
        "auto" | "" => None,
        _ => None,
    };
    if let Some(c) = codec_arg {
        cmd.arg("-c:a").arg(c);
    }

    if opts.bitrate != "auto" && !opts.bitrate.is_empty() {
        let b = if opts.bitrate.ends_with('k') || opts.bitrate.ends_with('K') {
            opts.bitrate.clone()
        } else {
            format!("{}k", opts.bitrate)
        };
        cmd.arg("-b:a").arg(b);
    }

    if opts.sample_rate != "auto" && !opts.sample_rate.is_empty() {
        cmd.arg("-ar").arg(&opts.sample_rate);
    }

    if opts.channels != "auto" && !opts.channels.is_empty() {
        cmd.arg("-ac").arg(&opts.channels);
    }

    cmd.arg("-vn"); // no video stream
    cmd.arg(out_path);
    apply_no_window(&mut cmd);

    let status = cmd.status().await.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("ffmpeg audio a échoué".to_string());
    }
    Ok(())
}

/// Convert one image file via FFmpeg.
async fn convert_image(
    ffmpeg: &PathBuf,
    source: &Path,
    out_path: &Path,
    opts: &ImageConvertOpts,
) -> std::result::Result<(), String> {
    let mut cmd = Command::new(ffmpeg);
    cmd.arg("-hide_banner").arg("-y").arg("-i").arg(source);

    // Resolution / max width
    if opts.resolution != "auto" && !opts.resolution.is_empty() {
        let scale = if opts.resolution.contains('x') {
            opts.resolution.replace('x', ":")
        } else {
            format!("{}:-1", opts.resolution)
        };
        cmd.arg("-vf").arg(format!("scale={}", scale));
    }

    // Quality
    if opts.quality != "auto" && !opts.quality.is_empty() {
        if let Ok(q) = opts.quality.parse::<i32>() {
            let q = q.clamp(1, 100);
            match opts.target_format.to_lowercase().as_str() {
                "jpg" | "jpeg" => {
                    // FFmpeg uses 2 (best) to 31 (worst) for mjpeg → map 1-100 to 31-2
                    let qscale = (31.0 - (q as f32 / 100.0) * 29.0) as i32;
                    cmd.arg("-q:v").arg(qscale.to_string());
                }
                "webp" => {
                    cmd.arg("-quality").arg(q.to_string());
                }
                "avif" => {
                    // AVIF: -crf 0 (lossless) to 63 (worst)
                    let crf = (63.0 - (q as f32 / 100.0) * 63.0) as i32;
                    cmd.arg("-crf").arg(crf.to_string());
                }
                _ => {}
            }
        }
    }

    cmd.arg(out_path);
    apply_no_window(&mut cmd);

    let status = cmd.status().await.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("ffmpeg image a échoué".to_string());
    }
    Ok(())
}

/// Convert one document via LibreOffice headless.
async fn convert_document(
    soffice: &PathBuf,
    source: &Path,
    out_dir: &Path,
    opts: &DocumentConvertOpts,
) -> std::result::Result<(), String> {
    let mut cmd = Command::new(soffice);
    cmd.arg("--headless")
        .arg("--convert-to")
        .arg(&opts.target_format)
        .arg("--outdir")
        .arg(out_dir)
        .arg(source);
    apply_no_window(&mut cmd);

    let status = cmd.status().await.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("LibreOffice a échoué".to_string());
    }
    Ok(())
}

/// Batch convert files using per-type options.
/// Returns a result with counts of succeeded/failed and a flag if LibreOffice was needed but missing.
pub async fn convert_files_batch(
    app: &AppHandle,
    opts: ConvertBatchOptions,
) -> Result<ConvertResult> {
    if opts.files.is_empty() {
        return Ok(ConvertResult {
            success: false,
            output_path: String::new(),
            total: 0,
            succeeded: 0,
            failed: 0,
            libreoffice_missing: false,
            error: Some("Aucun fichier à convertir".to_string()),
        });
    }

    let ffmpeg = get_ffmpeg_path(app)?;
    let out_dir = opts.output_dir.map(PathBuf::from).unwrap_or_else(default_convert_output_dir);
    std::fs::create_dir_all(&out_dir)?;

    let total = opts.files.len() as u32;
    let mut succeeded = 0u32;
    let mut failed = 0u32;
    let mut libreoffice_missing = false;
    let mut libreoffice_path: Option<PathBuf> = None;

    // Check if any doc conversion is needed and locate LibreOffice once
    let needs_libreoffice = opts.files.iter().any(|f| matches!(f.opts, ConvertOpts::Document(_)));
    if needs_libreoffice {
        libreoffice_path = find_libreoffice();
        if libreoffice_path.is_none() {
            libreoffice_missing = true;
        }
    }

    for (i, entry) in opts.files.iter().enumerate() {
        let source = PathBuf::from(&entry.source_path);
        if !source.exists() {
            failed += 1;
            continue;
        }
        let idx = (i + 1) as u32;
        let display_name = source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let _ = app.emit(
            "convert-progress",
            CompressProgress {
                percent: 0.0,
                stage: "scanning".to_string(),
                current_file: Some(display_name.clone()),
                file_index: Some(idx),
                total_files: Some(total),
            },
        );

        let result = match &entry.opts {
            ConvertOpts::Video(v_opts) => {
                let out_path = make_output_path(&source, &v_opts.target_format, &out_dir);
                convert_video(app, &ffmpeg, &source, &out_path, v_opts, idx, total).await
            }
            ConvertOpts::Audio(a_opts) => {
                let out_path = make_output_path(&source, &a_opts.target_format, &out_dir);
                convert_audio(&ffmpeg, &source, &out_path, a_opts).await
            }
            ConvertOpts::Image(i_opts) => {
                let out_path = make_output_path(&source, &i_opts.target_format, &out_dir);
                convert_image(&ffmpeg, &source, &out_path, i_opts).await
            }
            ConvertOpts::Document(d_opts) => {
                if let Some(soffice) = libreoffice_path.as_ref() {
                    convert_document(soffice, &source, &out_dir, d_opts).await
                } else {
                    Err("LibreOffice non installé".to_string())
                }
            }
        };

        match result {
            Ok(_) => {
                succeeded += 1;
                let _ = app.emit(
                    "convert-progress",
                    CompressProgress {
                        percent: 100.0,
                        stage: "converting".to_string(),
                        current_file: Some(display_name),
                        file_index: Some(idx),
                        total_files: Some(total),
                    },
                );
            }
            Err(e) => {
                failed += 1;
                tracing::warn!("Conversion failed for {}: {}", source.display(), e);
            }
        }
    }

    Ok(ConvertResult {
        success: succeeded > 0,
        output_path: out_dir.to_string_lossy().to_string(),
        total,
        succeeded,
        failed,
        libreoffice_missing,
        error: None,
    })
}
