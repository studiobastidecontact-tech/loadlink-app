use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoInfo {
    pub title: String,
    pub thumbnail: String,
    pub duration: u64,
    pub uploader: String,
    /// Map of "video_height" → filesize_bytes (best video+audio combo for that quality)
    /// Keys: "2160", "1440", "1080", "720", "480", "360", "max"
    pub video_sizes: std::collections::HashMap<String, u64>,
    /// Map of "audio_quality" → filesize_bytes for audio-only downloads
    /// Keys: "0" (best), "2", "5", "7", "9"
    pub audio_sizes: std::collections::HashMap<String, u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProgressUpdate {
    pub percent: f32,
    pub speed: String,
    pub eta: String,
    pub stage: String,
    pub playlist_index: Option<u32>,
    pub playlist_count: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompressProgress {
    pub percent: f32,
    pub stage: String,
    pub current_file: Option<String>,
    pub file_index: Option<u32>,
    pub total_files: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadResult {
    pub success: bool,
    pub file_path: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompressResult {
    pub success: bool,
    pub output_path: String,
    pub output_info: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateResult {
    pub updated: bool,
    pub version: String,
}

const AUDIO_FORMATS: &[&str] = &["mp3", "wav", "flac", "m4a", "ogg", "aac"];

fn is_audio_format(format: &str) -> bool {
    AUDIO_FORMATS.contains(&format)
}

// ========== Binary paths ==========

fn get_ytdlp_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(data_dir) = app.path().app_data_dir() {
        let updated = data_dir.join("yt-dlp.exe");
        if updated.exists() { return Ok(updated); }
    }
    if let Ok(resource_path) = app.path().resource_dir() {
        let p = resource_path.join("binaries").join("yt-dlp.exe");
        if p.exists() { return Ok(p); }
        let p2 = resource_path.join("yt-dlp.exe");
        if p2.exists() { return Ok(p2); }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(p) = exe.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
            let candidate = p.join("binaries").join("yt-dlp.exe");
            if candidate.exists() { return Ok(candidate); }
        }
    }
    Ok(PathBuf::from("yt-dlp.exe"))
}

fn get_ffmpeg_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(resource_path) = app.path().resource_dir() {
        let p = resource_path.join("binaries").join("ffmpeg.exe");
        if p.exists() { return Ok(p); }
        let p2 = resource_path.join("ffmpeg.exe");
        if p2.exists() { return Ok(p2); }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(p) = exe.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
            let candidate = p.join("binaries").join("ffmpeg.exe");
            if candidate.exists() { return Ok(candidate); }
        }
    }
    Ok(PathBuf::from("ffmpeg.exe"))
}

/// Browser cascade: Firefox first (no Windows lock), then Chromium-based
fn detect_browsers() -> Vec<&'static str> {
    let mut browsers = Vec::new();
    let local_app = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let app_data = std::env::var("APPDATA").unwrap_or_default();

    let firefox_path = format!("{}\\Mozilla\\Firefox\\Profiles", app_data);
    if std::path::Path::new(&firefox_path).exists() { browsers.push("firefox"); }

    let brave_path = format!("{}\\BraveSoftware\\Brave-Browser\\User Data", local_app);
    if std::path::Path::new(&brave_path).exists() { browsers.push("brave"); }

    let chrome_path = format!("{}\\Google\\Chrome\\User Data", local_app);
    if std::path::Path::new(&chrome_path).exists() { browsers.push("chrome"); }

    let edge_path = format!("{}\\Microsoft\\Edge\\User Data", local_app);
    if std::path::Path::new(&edge_path).exists() { browsers.push("edge"); }

    browsers
}

/// Translate yt-dlp errors into user-friendly French messages
fn translate_error(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if lower.contains("sign in to confirm") || lower.contains("not a bot") {
        return "YouTube demande une vérification. Connecte-toi à YouTube dans Firefox, puis réessaie.".to_string();
    }
    if lower.contains("could not copy") || lower.contains("database is locked") || lower.contains("permission denied") {
        return "Cookies verrouillés. Ferme Chrome/Brave/Edge et réessaie (ou installe Firefox).".to_string();
    }
    if lower.contains("video unavailable") || lower.contains("private video") {
        return "Vidéo indisponible ou privée.".to_string();
    }
    if lower.contains("video is age") || lower.contains("confirm your age") {
        return "Vidéo avec restriction d'âge. Connecte-toi à YouTube dans ton navigateur.".to_string();
    }
    if lower.contains("members-only") {
        return "Vidéo réservée aux membres.".to_string();
    }
    if lower.contains("unsupported url") {
        return "Site non supporté ou URL invalide.".to_string();
    }
    if lower.contains("http error 403") {
        return "Accès refusé par le serveur (403).".to_string();
    }
    if lower.contains("http error 404") {
        return "Vidéo introuvable (404).".to_string();
    }
    if lower.contains("unable to extract") {
        return "Impossible d'extraire. yt-dlp doit peut-être être mis à jour.".to_string();
    }
    let lines: Vec<&str> = stderr.lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with("WARNING"))
        .collect();
    if let Some(last) = lines.last() {
        return last.to_string();
    }
    "Erreur inconnue".to_string()
}

// ========== yt-dlp update ==========

#[tauri::command]
async fn update_ytdlp(app: AppHandle) -> Result<UpdateResult, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let target = data_dir.join("yt-dlp.exe");

    if !target.exists() {
        let bundled = get_ytdlp_path(&app)?;
        if bundled != target && bundled.exists() {
            std::fs::copy(&bundled, &target).map_err(|e| e.to_string())?;
        }
    }

    let current = get_version(&target).await.unwrap_or_default();

    let mut cmd = Command::new(&target);
    cmd.arg("--update").arg("--no-warnings");
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = timeout(Duration::from_secs(60), cmd.output())
        .await
        .map_err(|_| "Update timeout".to_string())?
        .map_err(|e| format!("Update failed: {}", e))?;

    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let new_version = get_version(&target).await.unwrap_or_default();
    let updated = combined.contains("Updated") || combined.contains("Updating")
        || (current != new_version && !new_version.is_empty());

    Ok(UpdateResult { updated, version: new_version })
}

async fn get_version(path: &PathBuf) -> Result<String, String> {
    let mut cmd = Command::new(path);
    cmd.arg("--version");
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = timeout(Duration::from_secs(5), cmd.output())
        .await
        .map_err(|_| "Version timeout".to_string())?
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// ========== Fetch info ==========

#[tauri::command]
async fn fetch_video_info(app: AppHandle, url: String) -> Result<VideoInfo, String> {
    let ytdlp = get_ytdlp_path(&app)?;
    let browsers = detect_browsers();
    let mut attempts: Vec<Option<&str>> = browsers.iter().map(|b| Some(*b)).collect();
    attempts.push(None);

    let mut last_error = String::new();

    for browser in attempts {
        let mut cmd = Command::new(&ytdlp);
        cmd.arg("--dump-single-json")
            .arg("--no-warnings")
            .arg("--skip-download")
            .arg("--no-playlist")
            .arg("--socket-timeout").arg("10");
        if let Some(b) = browser {
            cmd.arg("--cookies-from-browser").arg(b);
        }
        cmd.arg(&url);
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        let output = match timeout(Duration::from_secs(25), cmd.output()).await {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => { last_error = format!("Échec: {}", e); continue; }
            Err(_) => { last_error = "Délai dépassé".to_string(); continue; }
        };

        if !output.status.success() {
            last_error = String::from_utf8_lossy(&output.stderr).to_string();
            continue;
        }

        let json: serde_json::Value = match serde_json::from_slice(&output.stdout) {
            Ok(j) => j,
            Err(e) => { last_error = format!("JSON: {}", e); continue; }
        };

        // Parse formats to extract exact file sizes
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

    Err(translate_error(&last_error))
}

/// Extract file sizes per quality level from yt-dlp formats JSON
/// Returns (video_sizes_by_height, audio_sizes_by_quality)
fn extract_format_sizes(json: &serde_json::Value) -> (
    std::collections::HashMap<String, u64>,
    std::collections::HashMap<String, u64>,
) {
    use std::collections::HashMap;
    let mut video_sizes: HashMap<String, u64> = HashMap::new();
    let mut audio_sizes: HashMap<String, u64> = HashMap::new();

    let empty_vec = vec![];
    let formats = json["formats"].as_array().unwrap_or(&empty_vec);

    // Target heights for video quality buckets
    let target_heights = [2160u64, 1440, 1080, 720, 480, 360];

    // Find best audio-only stream size (for video+audio combo)
    let mut best_audio_size: u64 = 0;
    for fmt in formats {
        let vcodec = fmt["vcodec"].as_str().unwrap_or("");
        let acodec = fmt["acodec"].as_str().unwrap_or("");
        if vcodec == "none" && acodec != "none" {
            let size = fmt["filesize"].as_u64()
                .or_else(|| fmt["filesize_approx"].as_u64())
                .unwrap_or(0);
            if size > best_audio_size {
                best_audio_size = size;
            }
        }
    }

    // For each target height, find the best matching video-only stream
    for &target_h in &target_heights {
        let mut best_video_size: u64 = 0;
        let mut found_height: u64 = 0;

        for fmt in formats {
            let vcodec = fmt["vcodec"].as_str().unwrap_or("");
            if vcodec == "none" { continue; }
            let height = fmt["height"].as_u64().unwrap_or(0);
            if height == 0 || height > target_h { continue; }

            // Prefer matches closer to target (e.g. for 1080 target, accept 1080 > 720)
            let size = fmt["filesize"].as_u64()
                .or_else(|| fmt["filesize_approx"].as_u64())
                .unwrap_or(0);
            if size == 0 { continue; }

            if height > found_height || (height == found_height && size > best_video_size) {
                found_height = height;
                best_video_size = size;
            }
        }

        if best_video_size > 0 {
            // Video-only + best audio = combined size
            video_sizes.insert(target_h.to_string(), best_video_size + best_audio_size);
        }
    }

    // "max" = best available (highest height)
    let mut max_video_size: u64 = 0;
    let mut max_height: u64 = 0;
    for fmt in formats {
        let vcodec = fmt["vcodec"].as_str().unwrap_or("");
        if vcodec == "none" { continue; }
        let height = fmt["height"].as_u64().unwrap_or(0);
        let size = fmt["filesize"].as_u64()
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

    // Audio: best audio stream → map to all quality keys (since extraction re-encodes)
    // The actual file size depends on the target audio bitrate after extraction.
    // Use yt-dlp's source audio size as the "raw" baseline (key "0" = best)
    if best_audio_size > 0 {
        // Estimate sizes for each audio quality based on bitrate ratios.
        // yt-dlp -q value 0=320kbps, 2=256, 5=192, 7=128, 9=96
        // Source audio is typically ~128-256 kbps (Opus/AAC from YouTube)
        // We use the source size as the "max" and scale for others.
        // For lossless formats (wav, flac), the size will differ, but the JS layer handles that.
        let bitrates = [("0", 320u64), ("2", 256), ("5", 192), ("7", 128), ("9", 96)];
        // Assume source is roughly 160 kbps average for estimation baseline
        let source_kbps: u64 = 160;
        for (key, kbps) in bitrates.iter() {
            let scaled = (best_audio_size as f64 * (*kbps as f64) / source_kbps as f64) as u64;
            audio_sizes.insert(key.to_string(), scaled);
        }
        // Also keep a raw fallback
        audio_sizes.insert("raw".to_string(), best_audio_size);
    }

    (video_sizes, audio_sizes)
}

// ========== Download ==========

fn default_download_dir(format: &str) -> PathBuf {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| String::from("."));
    let base = PathBuf::from(user_profile);
    if is_audio_format(format) {
        base.join("Music").join("LoadLink-Audio")
    } else {
        base.join("Videos").join("LoadLink-Videos")
    }
}

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

#[tauri::command]
async fn download_video(
    app: AppHandle,
    url: String,
    format: String,
    quality: String,
    custom_name: Option<String>,
    custom_dir: Option<String>,
    is_playlist: Option<bool>,
) -> Result<DownloadResult, String> {
    let ytdlp = get_ytdlp_path(&app)?;
    let playlist_mode = is_playlist.unwrap_or(false);
    let audio_mode = is_audio_format(&format);

    let dest_dir = custom_dir.map(PathBuf::from)
        .unwrap_or_else(|| default_download_dir(&format));
    let final_dir = if playlist_mode { dest_dir.join("Playlist") } else { dest_dir.clone() };
    std::fs::create_dir_all(&final_dir).map_err(|e| format!("Cannot create folder: {}", e))?;

    let output_template = if playlist_mode {
        final_dir.join("%(playlist_index)02d - %(title)s.%(ext)s").to_string_lossy().to_string()
    } else {
        let name = custom_name.unwrap_or_else(|| "%(title)s".to_string());
        final_dir.join(format!("{}.%(ext)s", name)).to_string_lossy().to_string()
    };

    let ffmpeg = get_ffmpeg_path(&app)?;

    let mut cmd = Command::new(&ytdlp);

    // Tell yt-dlp where ffmpeg is - critical for merging audio+video and audio conversion
    cmd.arg("--ffmpeg-location").arg(&ffmpeg);

    if audio_mode {
        cmd.arg("-f").arg("bestaudio")
            .arg("--extract-audio")
            .arg("--audio-format").arg(&format)
            .arg("--audio-quality").arg(&quality);
    } else {
        let selector = build_video_format_selector(&quality, &format);
        cmd.arg("-f").arg(&selector)
            .arg("--merge-output-format").arg(&format);
    }

    if !playlist_mode { cmd.arg("--no-playlist"); } else { cmd.arg("--yes-playlist"); }

    cmd.arg("--newline").arg("--progress").arg("--ignore-errors")
        .arg("-o").arg(&output_template)
        .arg(&url);

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd.spawn().map_err(|e| format!("Spawn failed: {}", e))?;
    let stdout = child.stdout.take().ok_or_else(|| "No stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "No stderr".to_string())?;

    let app_clone = app.clone();
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let progress_re = regex::Regex::new(
            r"\[download\]\s+(\d+\.?\d*)%\s+of\s+~?\s*\S+\s+at\s+(\S+)\s+ETA\s+(\S+)",
        ).unwrap();
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
                let _ = app_clone.emit("download-progress", ProgressUpdate {
                    percent: p,
                    speed: c[2].to_string(),
                    eta: c[3].to_string(),
                    stage: "downloading".to_string(),
                    playlist_index: cur,
                    playlist_count: tot,
                });
            } else if merge_re.is_match(&line) {
                let _ = app_clone.emit("download-progress", ProgressUpdate {
                    percent: 99.0, speed: String::new(), eta: String::new(),
                    stage: "merging".to_string(),
                    playlist_index: cur, playlist_count: tot,
                });
            } else if extract_re.is_match(&line) {
                let _ = app_clone.emit("download-progress", ProgressUpdate {
                    percent: 99.0, speed: String::new(), eta: String::new(),
                    stage: "extracting".to_string(),
                    playlist_index: cur, playlist_count: tot,
                });
            }
        }
    });

    let mut stderr_lines = Vec::new();
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut lines = Vec::new();
        while let Ok(Some(line)) = reader.next_line().await { lines.push(line); }
        lines
    });

    let status = child.wait().await.map_err(|e| format!("Process error: {}", e))?;
    let _ = stdout_task.await;
    if let Ok(lines) = stderr_task.await { stderr_lines = lines; }

    if !status.success() {
        return Ok(DownloadResult {
            success: false, file_path: String::new(),
            error: Some(stderr_lines.join("\n")),
        });
    }

    Ok(DownloadResult {
        success: true,
        file_path: final_dir.to_string_lossy().to_string(),
        error: None,
    })
}

// ========== ZIP compression ==========

fn collect_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if dir.is_file() {
        files.push(dir.to_path_buf());
        return files;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() { files.extend(collect_files(&path)); }
            else { files.push(path); }
        }
    }
    files
}

#[tauri::command]
async fn compress_zip(
    app: AppHandle,
    source: String,
    output_dir: Option<String>,
    level: i32,
) -> Result<CompressResult, String> {
    let source_path = PathBuf::from(&source);
    if !source_path.exists() {
        return Ok(CompressResult { success: false, output_path: String::new(), output_info: None, error: Some("Source introuvable".to_string()) });
    }

    let folder_name = source_path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "archive".to_string());

    // Default output: Videos\LoadLink-Videos (centralised location)
    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| String::from("."));
    let out_dir = output_dir.map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(&user_profile).join("Videos").join("LoadLink-Videos"));
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let zip_path = out_dir.join(format!("[ZIP] {}.zip", folder_name));

    let files = collect_files(&source_path);
    let total = files.len() as u32;

    let app_clone = app.clone();
    let zip_path_clone = zip_path.clone();
    let source_clone = source_path.clone();

    // Run zipping in blocking task
    let result = tokio::task::spawn_blocking(move || -> Result<u64, String> {
        use std::fs::File;
        use std::io::{Read, Write};
        use zip::write::FileOptions;
        use zip::CompressionMethod;

        let file = File::create(&zip_path_clone).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);

        let method = if level == 0 { CompressionMethod::Stored } else { CompressionMethod::Deflated };
        let options: FileOptions<()> = FileOptions::default()
            .compression_method(method)
            .compression_level(if level == 0 { None } else { Some(level as i64) })
            .unix_permissions(0o755);

        let base = if source_clone.is_dir() {
            source_clone.clone()
        } else {
            source_clone.parent().unwrap_or(Path::new(".")).to_path_buf()
        };

        let mut buf = Vec::with_capacity(8 * 1024 * 1024);

        for (i, path) in files.iter().enumerate() {
            let rel = path.strip_prefix(&base).unwrap_or(path);
            let name = rel.to_string_lossy().replace('\\', "/");

            let _ = app_clone.emit("compress-progress", CompressProgress {
                percent: (i as f32 / total.max(1) as f32) * 100.0,
                stage: "zipping".to_string(),
                current_file: Some(name.clone()),
                file_index: Some(i as u32 + 1),
                total_files: Some(total),
            });

            zip.start_file(&name, options).map_err(|e| e.to_string())?;
            let mut f = File::open(path).map_err(|e| e.to_string())?;
            buf.clear();
            f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            zip.write_all(&buf).map_err(|e| e.to_string())?;
        }

        zip.finish().map_err(|e| e.to_string())?;
        Ok(std::fs::metadata(&zip_path_clone).map(|m| m.len()).unwrap_or(0))
    }).await.map_err(|e| e.to_string())?;

    match result {
        Ok(size) => {
            let info = format!("Archive : {:.1} Mo", size as f64 / 1_048_576.0);
            let _ = app.emit("compress-progress", CompressProgress {
                percent: 100.0,
                stage: "zipping".to_string(),
                current_file: None,
                file_index: Some(total),
                total_files: Some(total),
            });
            Ok(CompressResult {
                success: true,
                output_path: zip_path.to_string_lossy().to_string(),
                output_info: Some(info),
                error: None,
            })
        }
        Err(e) => Ok(CompressResult {
            success: false, output_path: String::new(),
            output_info: None, error: Some(e),
        }),
    }
}

// ========== Video reencoding (H.265) ==========

fn is_video_file(path: &Path) -> bool {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        matches!(ext.to_lowercase().as_str(), "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" | "flv" | "wmv" | "mts" | "ts")
    } else { false }
}

#[tauri::command]
async fn reencode_videos(
    app: AppHandle,
    source: String,
    output_dir: Option<String>,
    mode: String,        // "crf" or "bitrate"
    crf: i32,            // used when mode="crf" (18-32)
    bitrate_ratio: f32,  // used when mode="bitrate" (0.3 = 30% of original)
) -> Result<CompressResult, String> {
    let ffmpeg = get_ffmpeg_path(&app)?;
    let source_path = PathBuf::from(&source);
    if !source_path.exists() {
        return Ok(CompressResult { success: false, output_path: String::new(), output_info: None, error: Some("Source introuvable".to_string()) });
    }

    let _ = app.emit("compress-progress", CompressProgress {
        percent: 0.0, stage: "scanning".to_string(),
        current_file: None, file_index: None, total_files: None,
    });

    let all_files = collect_files(&source_path);
    let videos: Vec<PathBuf> = all_files.into_iter().filter(|p| is_video_file(p)).collect();

    if videos.is_empty() {
        return Ok(CompressResult {
            success: false, output_path: String::new(),
            output_info: None,
            error: Some("Aucune vidéo trouvée dans ce dossier".to_string()),
        });
    }

    let folder_name = source_path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "compressed".to_string());

    // Default output: Videos\LoadLink-Videos (centralised location)
    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| String::from("."));
    let out_root = output_dir.map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(&user_profile).join("Videos").join("LoadLink-Videos"));
    let suffix = if mode == "bitrate" {
        format!("-{}pct", (bitrate_ratio * 100.0) as i32)
    } else {
        "-H265".to_string()
    };
    let target_root = out_root.join(format!("[COMPRESSED] {}{}", folder_name, suffix));
    std::fs::create_dir_all(&target_root).map_err(|e| e.to_string())?;

    let base = if source_path.is_dir() { source_path.clone() }
        else { source_path.parent().unwrap_or(Path::new(".")).to_path_buf() };

    let total = videos.len() as u32;
    let mut total_in: u64 = 0;
    let mut total_out: u64 = 0;

    for (i, video) in videos.iter().enumerate() {
        let rel = video.strip_prefix(&base).unwrap_or(video);
        let out_path = target_root.join(rel).with_extension("mp4");
        if let Some(p) = out_path.parent() { std::fs::create_dir_all(p).ok(); }

        let name = rel.to_string_lossy().to_string();

        // Probe duration AND bitrate of source
        let (duration_secs, source_bitrate) = probe_video_info(&ffmpeg, video).await;

        let mut cmd = Command::new(&ffmpeg);
        cmd.arg("-hide_banner").arg("-y")
            .arg("-i").arg(video)
            .arg("-c:v").arg("libx265")
            .arg("-preset").arg("medium");

        if mode == "bitrate" && source_bitrate > 0 {
            // Bitrate mode: target = source_bitrate * ratio (guaranteed reduction)
            let target_kbps = ((source_bitrate as f32 / 1000.0) * bitrate_ratio) as i32;
            let target_kbps = target_kbps.max(200); // floor
            cmd.arg("-b:v").arg(format!("{}k", target_kbps))
                .arg("-maxrate").arg(format!("{}k", (target_kbps as f32 * 1.5) as i32))
                .arg("-bufsize").arg(format!("{}k", target_kbps * 2));
        } else {
            // CRF mode (or fallback if bitrate probe failed)
            cmd.arg("-crf").arg(crf.to_string());
        }

        cmd.arg("-c:a").arg("aac")
            .arg("-b:a").arg("192k")
            .arg("-progress").arg("pipe:1")
            .arg("-nostats")
            .arg(&out_path);

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        let mut child = cmd.spawn().map_err(|e| format!("ffmpeg spawn: {}", e))?;
        let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;

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
                    let percent = if dur > 0.0 { (processed / dur * 100.0).min(99.0) } else { 50.0 };
                    let _ = app_clone.emit("compress-progress", CompressProgress {
                        percent,
                        stage: "reencoding".to_string(),
                        current_file: Some(name_clone.clone()),
                        file_index: Some(idx),
                        total_files: Some(total),
                    });
                }
            }
        });

        let status = child.wait().await.map_err(|e| e.to_string())?;
        let _ = stdout_task.await;

        if !status.success() { continue; }

        total_in += std::fs::metadata(video).map(|m| m.len()).unwrap_or(0);
        total_out += std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
    }

    let saved_pct = if total_in > 0 { (1.0 - total_out as f64 / total_in as f64) * 100.0 } else { 0.0 };
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

/// Probes a video for duration and source bitrate using ffmpeg.
/// Returns (duration_seconds, bitrate_bps).
async fn probe_video_info(ffmpeg: &PathBuf, video: &Path) -> (f32, u64) {
    let mut cmd = Command::new(ffmpeg);
    cmd.arg("-i").arg(video);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = match timeout(Duration::from_secs(10), cmd.output()).await {
        Ok(Ok(o)) => o,
        _ => return (0.0, 0),
    };
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Parse duration "Duration: HH:MM:SS.cc"
    let dur_re = regex::Regex::new(r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)").unwrap();
    let duration = if let Some(c) = dur_re.captures(&stderr) {
        let h: f32 = c[1].parse().unwrap_or(0.0);
        let m: f32 = c[2].parse().unwrap_or(0.0);
        let s: f32 = c[3].parse().unwrap_or(0.0);
        let cs: f32 = c[4].parse().unwrap_or(0.0);
        h * 3600.0 + m * 60.0 + s + cs / 100.0
    } else { 0.0 };

    // Try to get video stream bitrate first (more accurate)
    // Pattern: "Stream #0:0[0x1](und): Video: ... 1234 kb/s"
    let stream_bitrate_re = regex::Regex::new(r"Stream #\d+:\d+.*?Video:.*?(\d+)\s*kb/s").unwrap();
    if let Some(c) = stream_bitrate_re.captures(&stderr) {
        if let Ok(kbps) = c[1].parse::<u64>() {
            return (duration, kbps * 1000);
        }
    }

    // Fall back to container bitrate: "bitrate: 1234 kb/s"
    let container_bitrate_re = regex::Regex::new(r"bitrate:\s*(\d+)\s*kb/s").unwrap();
    if let Some(c) = container_bitrate_re.captures(&stderr) {
        if let Ok(kbps) = c[1].parse::<u64>() {
            // Container bitrate includes audio, subtract ~128kbps estimate
            let video_estimate = kbps.saturating_sub(128);
            return (duration, video_estimate * 1000);
        }
    }

    // Final fallback: estimate from file size and duration
    if duration > 0.0 {
        if let Ok(meta) = std::fs::metadata(video) {
            let size_bits = meta.len() * 8;
            let estimated_bps = (size_bits as f32 / duration) as u64;
            return (duration, estimated_bps);
        }
    }

    (duration, 0)
}

/// Kept for compatibility (now just a wrapper)
async fn probe_duration(ffmpeg: &PathBuf, video: &Path) -> Result<f32, String> {
    let (dur, _) = probe_video_info(ffmpeg, video).await;
    Ok(dur)
}

// ========== Open folder ==========

#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    #[cfg(windows)] { Command::new("explorer").arg(&path).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "macos")] { Command::new("open").arg(&path).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
async fn open_default_folder(is_audio: bool) -> Result<(), String> {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    let folder = if is_audio {
        PathBuf::from(&user_profile).join("Music").join("LoadLink-Audio")
    } else {
        PathBuf::from(&user_profile).join("Videos").join("LoadLink-Videos")
    };
    std::fs::create_dir_all(&folder).ok();
    open_folder(folder.to_string_lossy().to_string()).await
}

// ========== Run ==========

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            fetch_video_info,
            download_video,
            open_folder,
            open_default_folder,
            update_ytdlp,
            compress_zip,
            reencode_videos,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
