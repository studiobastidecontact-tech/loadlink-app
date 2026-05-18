//! # loadlink-converter
//!
//! Video conversion and reencoding using FFmpeg.
//!
//! Current capabilities:
//! - Reencode videos to H.265 (HEVC) with CRF or target bitrate modes
//! - Probe video duration and bitrate for accurate target sizing
//! - Recursive directory scanning for batch operations
//!
//! Future (Phase 2+): presets sociaux, format conversion (MP4 ↔ WEBM ↔ MOV).

use loadlink_core::{CompressProgress, CompressResult, LoadlinkError, Result};
use loadlink_workers::{apply_no_window, get_ffmpeg_path};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

// ============================================
// Options
// ============================================

#[derive(Debug, Clone)]
pub struct ReencodeOptions {
    pub source: String,
    pub output_dir: Option<String>,
    /// "crf" or "bitrate"
    pub mode: String,
    /// CRF value, used when mode="crf" (18-32)
    pub crf: i32,
    /// Ratio, used when mode="bitrate" (e.g. 0.5 = 50% of source bitrate)
    pub bitrate_ratio: f32,
}

// ============================================
// File helpers
// ============================================

/// Returns `true` if the given path has a known video extension.
pub fn is_video_file(path: &Path) -> bool {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        matches!(
            ext.to_lowercase().as_str(),
            "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" | "flv" | "wmv" | "mts" | "ts"
        )
    } else {
        false
    }
}

/// Recursively collects all files under a directory (or returns a single file).
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
// Video probing (duration + bitrate)
// ============================================

/// Probes a video for duration and source bitrate using ffmpeg.
/// Returns (duration_seconds, bitrate_bps).
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
// Main reencode operation
// ============================================

/// Reencodes all videos in a source folder to H.265.
///
/// Reports progress via the `compress-progress` Tauri event.
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
