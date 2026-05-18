//! # loadlink-importer
//!
//! Media import operations:
//! - `fetch_info`: fetches metadata for a URL (title, duration, sizes per quality)
//! - `download`: downloads media via yt-dlp with progress reporting
//!
//! ## Encoding fix (v4)
//!
//! On Windows, the default console encoding is cp1252 which crashes yt-dlp
//! when video titles contain Unicode characters. The fix:
//! 1. Set PYTHONIOENCODING=utf-8 and PYTHONUTF8=1 on the child process env.
//! 2. Pass --encoding utf-8 to yt-dlp itself (native yt-dlp flag).
//! 3. Use yt-dlp's --no-progress-template-render to avoid stdout buffering issues.
//!
//! This is simpler and more reliable than wrapping through cmd.exe /C chcp 65001.

use loadlink_core::{is_audio_format, LoadlinkError, ProgressUpdate, Result, VideoInfo};
use loadlink_workers::{
    apply_no_window, detect_browsers, get_ffmpeg_path, get_ytdlp_path, translate_error,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Clone)]
pub struct DownloadOptions {
    pub url: String,
    pub format: String,
    pub quality: String,
    pub custom_name: Option<String>,
    pub custom_dir: Option<String>,
    pub is_playlist: bool,
}

// ============================================
// UTF-8 environment + native yt-dlp encoding flag
// ============================================

/// Apply UTF-8 environment to a tokio Command.
/// This MUST be called BEFORE spawning to avoid cp1252 crashes on Windows.
fn apply_utf8_env(cmd: &mut Command) {
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("PYTHONUTF8", "1");
    // Also clear LANG/LC_ALL on Windows just in case
    cmd.env("LANG", "C.UTF-8");
    cmd.env("LC_ALL", "C.UTF-8");
}

// ============================================
// JS runtime detection (required by yt-dlp for YouTube extraction)
// ============================================

fn detect_js_runtime() -> Option<String> {
    let node_paths = [
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\Program Files (x86)\\nodejs\\node.exe",
    ];
    for path in &node_paths {
        if std::path::Path::new(path).exists() {
            return Some(format!("node:{}", path));
        }
    }

    if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
        let nvm_path = format!("{}\\nvm", local_app);
        if std::path::Path::new(&nvm_path).exists() {
            if let Ok(entries) = std::fs::read_dir(&nvm_path) {
                for entry in entries.flatten() {
                    let candidate = entry.path().join("node.exe");
                    if candidate.exists() {
                        return Some(format!("node:{}", candidate.to_string_lossy()));
                    }
                }
            }
        }
    }

    let deno_path = format!(
        "{}\\.deno\\bin\\deno.exe",
        std::env::var("USERPROFILE").unwrap_or_default()
    );
    if std::path::Path::new(&deno_path).exists() {
        return Some(format!("deno:{}", deno_path));
    }

    None
}

fn apply_js_runtime(cmd: &mut Command) {
    if let Some(runtime) = detect_js_runtime() {
        cmd.arg("--js-runtimes").arg(runtime);
    }
}

pub fn default_download_dir(format: &str) -> PathBuf {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| String::from("."));
    let base = PathBuf::from(user_profile);
    if is_audio_format(format) {
        base.join("Music").join("LoadLink-Audio")
    } else {
        base.join("Videos").join("LoadLink-Videos")
    }
}

// ============================================
// fetch_info
// ============================================

pub async fn fetch_info(app: &AppHandle, url: &str) -> Result<VideoInfo> {
    let ytdlp = get_ytdlp_path(app)?;
    let browsers = detect_browsers();

    let mut attempts: Vec<Option<&str>> = browsers.iter().map(|b| Some(*b)).collect();
    attempts.push(None);

    let mut last_error = String::new();

    for browser in attempts {
        let mut cmd = Command::new(&ytdlp);

        // CRITICAL: env vars MUST be set before spawn
        apply_utf8_env(&mut cmd);

        cmd.arg("--encoding")
            .arg("utf-8")
            .arg("--dump-single-json")
            .arg("--no-warnings")
            .arg("--skip-download")
            .arg("--no-playlist")
            .arg("--socket-timeout")
            .arg("10");

        apply_js_runtime(&mut cmd);

        if let Some(b) = browser {
            cmd.arg("--cookies-from-browser").arg(b);
        }
        cmd.arg(url);
        apply_no_window(&mut cmd);

        let output = match timeout(Duration::from_secs(25), cmd.output()).await {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => {
                last_error = format!("Échec: {}", e);
                continue;
            }
            Err(_) => {
                last_error = "Délai dépassé".to_string();
                continue;
            }
        };

        if !output.status.success() {
            last_error = String::from_utf8_lossy(&output.stderr).to_string();
            continue;
        }

        let json: serde_json::Value = match serde_json::from_slice(&output.stdout) {
            Ok(j) => j,
            Err(e) => {
                last_error = format!("JSON: {}", e);
                continue;
            }
        };

        let (video_sizes, audio_sizes) = extract_format_sizes(&json);

        return Ok(VideoInfo {
            title: json["title"].as_str().unwrap_or("Sans titre").to_string(),
            thumbnail: json["thumbnail"].as_str().unwrap_or("").to_string(),
            duration: json["duration"].as_u64().unwrap_or(0),
            uploader: json["uploader"].as_str().unwrap_or("").to_string(),
            video_sizes,
            audio_sizes,
        });
    }

    Err(LoadlinkError::Other(translate_error(&last_error)))
}

fn extract_format_sizes(
    json: &serde_json::Value,
) -> (HashMap<String, u64>, HashMap<String, u64>) {
    let mut video_sizes: HashMap<String, u64> = HashMap::new();
    let mut audio_sizes: HashMap<String, u64> = HashMap::new();

    let empty_vec = vec![];
    let formats = json["formats"].as_array().unwrap_or(&empty_vec);

    let target_heights = [2160u64, 1440, 1080, 720, 480, 360];

    let mut best_audio_size: u64 = 0;
    for fmt in formats {
        let vcodec = fmt["vcodec"].as_str().unwrap_or("");
        let acodec = fmt["acodec"].as_str().unwrap_or("");
        if vcodec == "none" && acodec != "none" {
            let size = fmt["filesize"]
                .as_u64()
                .or_else(|| fmt["filesize_approx"].as_u64())
                .unwrap_or(0);
            if size > best_audio_size {
                best_audio_size = size;
            }
        }
    }

    for &target_h in &target_heights {
        let mut best_video_size: u64 = 0;
        let mut found_height: u64 = 0;

        for fmt in formats {
            let vcodec = fmt["vcodec"].as_str().unwrap_or("");
            if vcodec == "none" {
                continue;
            }
            let height = fmt["height"].as_u64().unwrap_or(0);
            if height == 0 || height > target_h {
                continue;
            }

            let size = fmt["filesize"]
                .as_u64()
                .or_else(|| fmt["filesize_approx"].as_u64())
                .unwrap_or(0);
            if size == 0 {
                continue;
            }

            if height > found_height || (height == found_height && size > best_video_size) {
                found_height = height;
                best_video_size = size;
            }
        }

        if best_video_size > 0 {
            video_sizes.insert(target_h.to_string(), best_video_size + best_audio_size);
        }
    }

    let mut max_video_size: u64 = 0;
    let mut max_height: u64 = 0;
    for fmt in formats {
        let vcodec = fmt["vcodec"].as_str().unwrap_or("");
        if vcodec == "none" {
            continue;
        }
        let height = fmt["height"].as_u64().unwrap_or(0);
        let size = fmt["filesize"]
            .as_u64()
            .or_else(|| fmt["filesize_approx"].as_u64())
            .unwrap_or(0);
        if height > max_height && size > 0 {
            max_height = height;
            max_video_size = size;
        }
    }
    if max_video_size > 0 {
        video_sizes.insert("max".to_string(), max_video_size + best_audio_size);
    }

    if best_audio_size > 0 {
        let bitrates = [("0", 320u64), ("2", 256), ("5", 192), ("7", 128), ("9", 96)];
        let source_kbps: u64 = 160;
        for (key, kbps) in bitrates.iter() {
            let scaled = (best_audio_size as f64 * (*kbps as f64) / source_kbps as f64) as u64;
            audio_sizes.insert(key.to_string(), scaled);
        }
        audio_sizes.insert("raw".to_string(), best_audio_size);
    }

    (video_sizes, audio_sizes)
}

// ============================================
// Download
// ============================================

fn build_video_format_selector(quality: &str, container: &str) -> String {
    let height_filter = match quality {
        "max" => "".to_string(),
        h => format!("[height<={}]", h),
    };
    if container == "webm" {
        format!(
            "bestvideo{}[ext=webm]+bestaudio[ext=webm]/bestvideo{}+bestaudio/best{}",
            height_filter, height_filter, height_filter
        )
    } else {
        format!(
            "bestvideo{}[ext=mp4]+bestaudio[ext=m4a]/bestvideo{}+bestaudio/best{}",
            height_filter, height_filter, height_filter
        )
    }
}

pub async fn download(app: &AppHandle, opts: DownloadOptions) -> Result<String> {
    let ytdlp = get_ytdlp_path(app)?;
    let audio_mode = is_audio_format(&opts.format);

    let dest_dir = opts
        .custom_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| default_download_dir(&opts.format));
    let final_dir = if opts.is_playlist {
        dest_dir.join("Playlist")
    } else {
        dest_dir.clone()
    };
    std::fs::create_dir_all(&final_dir)?;

    let output_template = if opts.is_playlist {
        final_dir
            .join("%(playlist_index)02d - %(title)s.%(ext)s")
            .to_string_lossy()
            .to_string()
    } else {
        let name = opts.custom_name.unwrap_or_else(|| "%(title)s".to_string());
        final_dir
            .join(format!("{}.%(ext)s", name))
            .to_string_lossy()
            .to_string()
    };

    let ffmpeg = get_ffmpeg_path(app)?;

    let mut cmd = Command::new(&ytdlp);

    // CRITICAL: env vars MUST be set before spawn
    apply_utf8_env(&mut cmd);

    cmd.arg("--encoding")
        .arg("utf-8")
        .arg("--ffmpeg-location")
        .arg(&ffmpeg);

    apply_js_runtime(&mut cmd);

    if audio_mode {
        cmd.arg("-f")
            .arg("bestaudio")
            .arg("--extract-audio")
            .arg("--audio-format")
            .arg(&opts.format)
            .arg("--audio-quality")
            .arg(&opts.quality);
    } else {
        let selector = build_video_format_selector(&opts.quality, &opts.format);
        cmd.arg("-f")
            .arg(&selector)
            .arg("--merge-output-format")
            .arg(&opts.format);
    }

    if !opts.is_playlist {
        cmd.arg("--no-playlist");
    } else {
        cmd.arg("--yes-playlist");
    }

    cmd.arg("--newline")
        .arg("--progress")
        .arg("--ignore-errors")
        .arg("-o")
        .arg(&output_template)
        .arg(&opts.url);

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    apply_no_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| LoadlinkError::SpawnFailed(e.to_string()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| LoadlinkError::Other("No stdout".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| LoadlinkError::Other("No stderr".to_string()))?;

    let app_clone = app.clone();
    let stdout_task = tokio::spawn(async move {
        parse_progress_stdout(stdout, app_clone).await;
    });

    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut lines = Vec::new();
        while let Ok(Some(line)) = reader.next_line().await {
            lines.push(line);
        }
        lines
    });

    let status = child
        .wait()
        .await
        .map_err(|e| LoadlinkError::Other(format!("Process error: {}", e)))?;
    let _ = stdout_task.await;
    let stderr_lines = stderr_task.await.unwrap_or_default();

    if !status.success() {
        let stderr_text = stderr_lines.join("\n");
        return Err(LoadlinkError::ProcessFailed(
            status.code().unwrap_or(-1),
            stderr_text,
        ));
    }

    Ok(final_dir.to_string_lossy().to_string())
}

async fn parse_progress_stdout(
    stdout: tokio::process::ChildStdout,
    app: AppHandle,
) {
    let mut reader = BufReader::new(stdout).lines();

    let progress_re = regex::Regex::new(
        r"\[download\]\s+(\d+\.?\d*)%\s+of\s+~?\s*\S+\s+at\s+(\S+)\s+ETA\s+(\S+)",
    )
    .unwrap();
    let merge_re = regex::Regex::new(r"\[Merger\]").unwrap();
    let extract_re = regex::Regex::new(r"\[ExtractAudio\]").unwrap();
    let playlist_re = regex::Regex::new(r"Downloading item (\d+) of (\d+)").unwrap();

    let mut cur: Option<u32> = None;
    let mut tot: Option<u32> = None;

    while let Ok(Some(line)) = reader.next_line().await {
        if let Some(c) = playlist_re.captures(&line) {
            cur = c[1].parse().ok();
            tot = c[2].parse().ok();
        } else if let Some(c) = progress_re.captures(&line) {
            let p: f32 = c[1].parse().unwrap_or(0.0);
            let _ = app.emit(
                "download-progress",
                ProgressUpdate {
                    percent: p,
                    speed: c[2].to_string(),
                    eta: c[3].to_string(),
                    stage: "downloading".to_string(),
                    playlist_index: cur,
                    playlist_count: tot,
                },
            );
        } else if merge_re.is_match(&line) {
            let _ = app.emit(
                "download-progress",
                ProgressUpdate {
                    percent: 99.0,
                    speed: String::new(),
                    eta: String::new(),
                    stage: "merging".to_string(),
                    playlist_index: cur,
                    playlist_count: tot,
                },
            );
        } else if extract_re.is_match(&line) {
            let _ = app.emit(
                "download-progress",
                ProgressUpdate {
                    percent: 99.0,
                    speed: String::new(),
                    eta: String::new(),
                    stage: "extracting".to_string(),
                    playlist_index: cur,
                    playlist_count: tot,
                },
            );
        }
    }
}

// ============================================
// yt-dlp self-update
// ============================================

use loadlink_core::UpdateResult;
use loadlink_workers::get_ytdlp_version;
use tauri::Manager;

pub async fn update_ytdlp(app: &AppHandle) -> Result<UpdateResult> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| LoadlinkError::Other(e.to_string()))?;
    std::fs::create_dir_all(&data_dir)?;
    let target = data_dir.join("yt-dlp.exe");

    if !target.exists() {
        let bundled = get_ytdlp_path(app)?;
        if bundled != target && bundled.exists() {
            std::fs::copy(&bundled, &target)?;
        }
    }

    let current = get_ytdlp_version(&target).await.unwrap_or_default();

    let mut cmd = Command::new(&target);
    apply_utf8_env(&mut cmd);
    cmd.arg("--update").arg("--no-warnings");
    apply_no_window(&mut cmd);

    let output = timeout(Duration::from_secs(60), cmd.output())
        .await
        .map_err(|_| LoadlinkError::Timeout)?
        .map_err(|e| LoadlinkError::SpawnFailed(e.to_string()))?;

    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let new_version = get_ytdlp_version(&target).await.unwrap_or_default();
    let updated = combined.contains("Updated")
        || combined.contains("Updating")
        || (current != new_version && !new_version.is_empty());

    Ok(UpdateResult {
        updated,
        version: new_version,
    })
}