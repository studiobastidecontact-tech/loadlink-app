//! # loadlink-workers
//!
//! Sidecar process management:
//! - Resolution of yt-dlp / ffmpeg binary paths
//! - Detection of installed browsers for cookies cascade
//! - User-friendly translation of yt-dlp errors
//! - Helper for spawning hidden Windows processes
//!
//! This crate centralizes everything that touches external binaries,
//! so that `importer` and `converter` don't duplicate platform-specific code.

use loadlink_core::{LoadlinkError, Result};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::time::timeout;

// ============================================
// Windows: prevent the console window from popping up
// when spawning a CLI binary from a GUI app.
// ============================================

/// On Windows, this flag prevents a console window from appearing
/// when spawning a child process.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Apply the "no console window" flag to a Command on Windows.
/// On non-Windows platforms, this is a no-op.
pub fn apply_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd; // silence unused warning
    }
}

// ============================================
// Binary path resolution
// ============================================

/// Returns the path to the yt-dlp binary.
///
/// Resolution order:
/// 1. `<AppData>/yt-dlp.exe` (updated version)
/// 2. `<ResourceDir>/binaries/yt-dlp.exe` (bundled)
/// 3. `<ResourceDir>/yt-dlp.exe` (fallback)
/// 4. Dev mode: `<exe_grandparent>/binaries/yt-dlp.exe`
/// 5. PATH fallback: just "yt-dlp.exe"
pub fn get_ytdlp_path(app: &AppHandle) -> Result<PathBuf> {
    // 1. Updated version in AppData
    if let Ok(data_dir) = app.path().app_data_dir() {
        let updated = data_dir.join("yt-dlp.exe");
        if updated.exists() {
            return Ok(updated);
        }
    }

    // 2 & 3. Bundled in resource dir
    if let Ok(resource_path) = app.path().resource_dir() {
        let p = resource_path.join("binaries").join("yt-dlp.exe");
        if p.exists() {
            return Ok(p);
        }
        let p2 = resource_path.join("yt-dlp.exe");
        if p2.exists() {
            return Ok(p2);
        }
    }

    // 4. Dev mode (next to target/debug/)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(p) = exe
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
        {
            let candidate = p.join("binaries").join("yt-dlp.exe");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // 5. Fallback: PATH
    Ok(PathBuf::from("yt-dlp.exe"))
}

/// Returns the path to the ffmpeg binary.
/// Same resolution strategy as yt-dlp (minus the AppData update lookup,
/// since ffmpeg is not auto-updated).
pub fn get_ffmpeg_path(app: &AppHandle) -> Result<PathBuf> {
    if let Ok(resource_path) = app.path().resource_dir() {
        let p = resource_path.join("binaries").join("ffmpeg.exe");
        if p.exists() {
            return Ok(p);
        }
        let p2 = resource_path.join("ffmpeg.exe");
        if p2.exists() {
            return Ok(p2);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(p) = exe
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
        {
            let candidate = p.join("binaries").join("ffmpeg.exe");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Ok(PathBuf::from("ffmpeg.exe"))
}

// ============================================
// Browser detection (for cookies cascade)
// ============================================

/// Detects which browsers are installed on this Windows machine.
///
/// Returns browser names compatible with `yt-dlp --cookies-from-browser`.
/// Order: Firefox first (doesn't lock cookies DB on Windows),
/// then Chromium-based browsers.
pub fn detect_browsers() -> Vec<&'static str> {
    let mut browsers = Vec::new();
    let local_app = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let app_data = std::env::var("APPDATA").unwrap_or_default();

    let firefox_path = format!("{}\\Mozilla\\Firefox\\Profiles", app_data);
    if std::path::Path::new(&firefox_path).exists() {
        browsers.push("firefox");
    }

    let brave_path = format!("{}\\BraveSoftware\\Brave-Browser\\User Data", local_app);
    if std::path::Path::new(&brave_path).exists() {
        browsers.push("brave");
    }

    let chrome_path = format!("{}\\Google\\Chrome\\User Data", local_app);
    if std::path::Path::new(&chrome_path).exists() {
        browsers.push("chrome");
    }

    let edge_path = format!("{}\\Microsoft\\Edge\\User Data", local_app);
    if std::path::Path::new(&edge_path).exists() {
        browsers.push("edge");
    }

    browsers
}

// ============================================
// User-friendly error translation
// ============================================

/// Translates yt-dlp stderr output into a user-friendly French message.
///
/// This is intentionally pattern-based (not exhaustive). It covers the most
/// common errors users actually hit (auth, age-gate, cookies lock, etc.).
pub fn translate_error(stderr: &str) -> String {
    let lower = stderr.to_lowercase();

    if lower.contains("sign in to confirm") || lower.contains("not a bot") {
        return "Vérification requise. Connecte-toi dans Firefox, puis réessaie.".to_string();
    }
    if lower.contains("could not copy")
        || lower.contains("database is locked")
        || lower.contains("permission denied")
    {
        return "Cookies verrouillés. Ferme Chrome/Brave/Edge et réessaie (ou installe Firefox)."
            .to_string();
    }
    if lower.contains("video unavailable") || lower.contains("private video") {
        return "Source indisponible ou privée.".to_string();
    }
    if lower.contains("video is age") || lower.contains("confirm your age") {
        return "Source avec restriction d'âge. Connecte-toi dans ton navigateur.".to_string();
    }
    if lower.contains("members-only") {
        return "Source réservée aux membres.".to_string();
    }
    if lower.contains("unsupported url") {
        return "Source non supportée ou URL invalide.".to_string();
    }
    if lower.contains("http error 403") {
        return "Accès refusé par le serveur (403).".to_string();
    }
    if lower.contains("http error 404") {
        return "Source introuvable (404).".to_string();
    }
    if lower.contains("unable to extract") {
        return "Impossible d'extraire. yt-dlp doit peut-être être mis à jour.".to_string();
    }

    let lines: Vec<&str> = stderr
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with("WARNING"))
        .collect();
    if let Some(last) = lines.last() {
        return last.to_string();
    }

    "Erreur inconnue".to_string()
}

// ============================================
// Helper: get yt-dlp version with timeout
// ============================================

/// Returns the yt-dlp version string by running `yt-dlp --version`.
/// Times out after 5 seconds.
pub async fn get_ytdlp_version(path: &PathBuf) -> Result<String> {
    let mut cmd = Command::new(path);
    cmd.arg("--version");
    apply_no_window(&mut cmd);

    let output = timeout(Duration::from_secs(5), cmd.output())
        .await
        .map_err(|_| LoadlinkError::Timeout)?
        .map_err(|e| LoadlinkError::SpawnFailed(e.to_string()))?;

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
