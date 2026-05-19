// loadlink-transcriber: Whisper-based audio/video transcription via Python embeddable
//
// Phase 4 - Module Transcrire
// Wraps faster-whisper running in a bundled Python 3.11 embeddable.
// Inputs: audio file, video file, or YouTube URL.
// Outputs: TXT, SRT, VTT, JSON.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscribeOptions {
    /// Path to a local file OR a YouTube URL.
    pub input: String,
    /// Output directory; if None, defaults to same dir as input (or Documents/LoadLink-Transcriptions for URLs).
    pub output_dir: Option<String>,
    /// Whisper model name: "tiny", "base", "small", "medium", "large-v3".
    pub model: String,
    /// ISO 639-1 language code (e.g. "fr", "en"); None for auto-detection.
    pub language: Option<String>,
    /// Output formats to generate: any subset of ["txt", "srt", "vtt", "json"].
    pub formats: Vec<String>,
    /// If true, translate to English instead of transcribing in source language.
    pub translate_to_english: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscribeResult {
    pub success: bool,
    /// Absolute paths of the generated output files.
    pub output_files: Vec<String>,
    /// Language detected by Whisper (None if user provided explicit language).
    pub language_detected: Option<String>,
    /// Audio duration in seconds.
    pub duration_seconds: Option<f64>,
    /// Error message if success == false.
    pub error: Option<String>,
}

/// Locate the bundled Python embeddable interpreter.
///
/// Resolution order:
/// 1. Production: <app_resources>/binaries/python/python.exe
/// 2. Development: <project_root>/src-tauri/binaries/python/python.exe
///
/// Returns the first existing path, or an error message if neither is found.
pub fn resolve_python_path(app: &AppHandle) -> Result<PathBuf, String> {
    // Try production path first (resource_dir)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir.join("binaries").join("python").join("python.exe");
        if prod_path.exists() {
            return Ok(prod_path);
        }
    }

    // Fallback: development path relative to current working directory
    // In `cargo run`, CWD is typically src-tauri/
    let dev_path = std::env::current_dir()
        .map_err(|e| format!("cannot get cwd: {}", e))?
        .join("binaries")
        .join("python")
        .join("python.exe");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err(format!(
        "Python embeddable introuvable. Cherche dans :\n  - resource_dir/binaries/python/python.exe\n  - {}",
        dev_path.display()
    ))
}

/// Locate the whisper_runner.py script bundled alongside Python.
///
/// Resolution order:
/// 1. Production: <app_resources>/binaries/python/scripts/whisper_runner.py
/// 2. Development: <project_root>/src-tauri/binaries/python/scripts/whisper_runner.py
pub fn resolve_runner_script(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir
            .join("binaries")
            .join("python")
            .join("scripts")
            .join("whisper_runner.py");
        if prod_path.exists() {
            return Ok(prod_path);
        }
    }

    let dev_path = std::env::current_dir()
        .map_err(|e| format!("cannot get cwd: {}", e))?
        .join("binaries")
        .join("python")
        .join("scripts")
        .join("whisper_runner.py");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err(format!(
        "whisper_runner.py introuvable. Cherche dans :\n  - resource_dir/binaries/python/scripts/whisper_runner.py\n  - {}",
        dev_path.display()
    ))
}

/// Run the transcription pipeline.
///
/// Spawns the bundled Python (src-tauri/binaries/python/python.exe) and runs
/// scripts/whisper_runner.py with the given options. Streams JSON progress
/// events on stdout, which are emitted to the frontend via Tauri events:
///   - "transcribe-progress"   { type, stage, pct }
///   - "transcribe-file"       { type, path }
///   - "transcribe-result"     final result
///
/// PHASE 4 STUB: returns a NotImplemented error for now.
/// Real implementation comes in step 1.3 (stdout streaming) and 2.x (Python runner).
pub async fn transcribe(
    _app: &AppHandle,
    _opts: TranscribeOptions,
) -> Result<TranscribeResult, String> {
    Err("transcribe: not yet implemented (Phase 4 stub, step 1.3 next)".to_string())
}
