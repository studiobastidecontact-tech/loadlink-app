//! # loadlink-core
//!
//! Shared types, traits and errors used across all LoadLink crates.
//! No dependencies on Tauri or external runtimes — pure data structures.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

// ============================================
// Domain types
// ============================================

/// Metadata about a video/audio source (fetched before download).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub title: String,
    pub thumbnail: String,
    pub duration: u64,
    pub uploader: String,
    /// Map of "video_height" → filesize_bytes (best video+audio combo)
    pub video_sizes: HashMap<String, u64>,
    /// Map of "audio_quality" → filesize_bytes for audio-only downloads
    pub audio_sizes: HashMap<String, u64>,
}

/// Progress update during a download operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressUpdate {
    pub percent: f32,
    pub speed: String,
    pub eta: String,
    pub stage: String,
    pub playlist_index: Option<u32>,
    pub playlist_count: Option<u32>,
}

/// Progress update during a compression operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressProgress {
    pub percent: f32,
    pub stage: String,
    pub current_file: Option<String>,
    pub file_index: Option<u32>,
    pub total_files: Option<u32>,
}

/// Result of a download operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadResult {
    pub success: bool,
    pub file_path: String,
    pub error: Option<String>,
}

/// Result of a compression operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressResult {
    pub success: bool,
    pub output_path: String,
    pub output_info: Option<String>,
    pub error: Option<String>,
}

/// Result of a yt-dlp update operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateResult {
    pub updated: bool,
    pub version: String,
}

// ============================================
// Format helpers
// ============================================

/// List of supported audio formats.
pub const AUDIO_FORMATS: &[&str] = &["mp3", "wav", "flac", "m4a", "ogg", "aac"];

/// Returns `true` if the given format is an audio format.
pub fn is_audio_format(format: &str) -> bool {
    AUDIO_FORMATS.contains(&format)
}

// ============================================
// Errors
// ============================================

/// Top-level error type for LoadLink operations.
#[derive(Debug, Error)]
pub enum LoadlinkError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Binary not found: {0}")]
    BinaryNotFound(String),

    #[error("Process spawn failed: {0}")]
    SpawnFailed(String),

    #[error("Process timeout")]
    Timeout,

    #[error("Process failed with code {0}: {1}")]
    ProcessFailed(i32, String),

    #[error("Invalid argument: {0}")]
    InvalidArgument(String),

    #[error("Other error: {0}")]
    Other(String),
}

impl LoadlinkError {
    /// Convenience constructor for "Other" errors.
    pub fn other(msg: impl Into<String>) -> Self {
        LoadlinkError::Other(msg.into())
    }
}

/// Convenience Result type used everywhere.
pub type Result<T> = std::result::Result<T, LoadlinkError>;
