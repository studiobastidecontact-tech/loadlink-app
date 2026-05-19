// loadlink-transcriber: Whisper-based audio/video transcription via Python embeddable
//
// Phase 4 - Module Transcrire
// Wraps faster-whisper running in a bundled Python 3.11 embeddable.
// Inputs: audio file, video file, or YouTube URL.
// Outputs: TXT, SRT, VTT, JSON.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

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
    Err("transcribe: not yet implemented (Phase 4 stub)".to_string())
}
