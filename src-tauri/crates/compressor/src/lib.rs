//! # loadlink-compressor
//!
//! ZIP archive creation with byte-level progress reporting.
//!
//! ## Drag & drop (Phase 2 v3)
//!
//! Two entry points for drag & drop:
//! - `compress_dropped_files`: small files (< 400 MB each) — base64 in memory
//! - Chunked upload API (`chunked_upload_*`): unlimited size, streamed to disk

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use loadlink_core::{CompressProgress, CompressResult, LoadlinkError, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

// ============================================
// Options
// ============================================

#[derive(Debug, Clone)]
pub struct ZipOptions {
    pub source: String,
    pub output_dir: Option<String>,
    pub level: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DroppedFile {
    pub filename: String,
    pub data: String, // base64
}

#[derive(Debug, Clone)]
pub struct DroppedFilesOptions {
    pub files: Vec<DroppedFile>,
    pub output_dir: Option<String>,
    pub level: i32,
    pub archive_name: Option<String>,
}

// ============================================
// Chunked upload state (Phase 2 v3)
// ============================================

/// Tracks an in-progress chunked upload.
/// One entry per file being streamed from the frontend.
struct UploadSession {
    temp_path: PathBuf,
    file: File,
    relative_path: String, // path inside the future archive (preserves subfolders)
    bytes_written: u64,
}

/// Shared state for chunked uploads, identified by upload_id (UUID).
#[derive(Default, Clone)]
pub struct ChunkedUploadState {
    sessions: Arc<Mutex<HashMap<String, UploadSession>>>,
    temp_root: Arc<Mutex<Option<PathBuf>>>, // a single session root for all files
}

impl ChunkedUploadState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start a new upload session. Creates a temp file and returns its ID.
    pub fn start(&self, relative_path: &str) -> std::result::Result<String, String> {
        // Ensure we have a session-wide temp root
        let mut root_lock = self.temp_root.lock().map_err(|e| e.to_string())?;
        let root = if let Some(r) = root_lock.as_ref() {
            r.clone()
        } else {
            let session_id = Uuid::new_v4().to_string();
            let r = std::env::temp_dir().join(format!("loadlink-drop-{}", &session_id[..12]));
            std::fs::create_dir_all(&r).map_err(|e| e.to_string())?;
            *root_lock = Some(r.clone());
            r
        };
        drop(root_lock);

        // Generate unique upload_id
        let upload_id = Uuid::new_v4().to_string();

        // Build the full temp file path, preserving subfolder structure
        let safe_rel = sanitize_relative_path(relative_path);
        let target = root.join(&safe_rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let file = File::create(&target).map_err(|e| e.to_string())?;

        let session = UploadSession {
            temp_path: target.clone(),
            file,
            relative_path: safe_rel,
            bytes_written: 0,
        };

        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        sessions.insert(upload_id.clone(), session);

        Ok(upload_id)
    }

    /// Append a chunk (base64) to an active upload.
    pub fn append(&self, upload_id: &str, chunk_b64: &str) -> std::result::Result<u64, String> {
        let bytes = B64
            .decode(chunk_b64.as_bytes())
            .map_err(|e| format!("Décodage base64 échoué : {}", e))?;

        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get_mut(upload_id)
            .ok_or_else(|| format!("Upload introuvable : {}", upload_id))?;

        session
            .file
            .write_all(&bytes)
            .map_err(|e| e.to_string())?;
        session.bytes_written += bytes.len() as u64;
        Ok(session.bytes_written)
    }

    /// Close all sessions, flush files, and return the session root for compression.
    /// Also returns the list of (relative_path, temp_path) for ZIP entries.
    pub fn finalize_session(
        &self,
        upload_ids: &[String],
    ) -> std::result::Result<(PathBuf, Vec<(String, PathBuf)>), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;

        let mut entries: Vec<(String, PathBuf)> = Vec::new();
        for id in upload_ids {
            if let Some(mut s) = sessions.remove(id) {
                s.file.flush().map_err(|e| e.to_string())?;
                drop(s.file);
                entries.push((s.relative_path.clone(), s.temp_path.clone()));
            }
        }

        let root_lock = self.temp_root.lock().map_err(|e| e.to_string())?;
        let root = root_lock
            .as_ref()
            .ok_or_else(|| "Aucune session active".to_string())?
            .clone();
        Ok((root, entries))
    }

    /// Clean up the entire temp root and reset state.
    pub fn cleanup(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
        if let Ok(mut root) = self.temp_root.lock() {
            if let Some(r) = root.take() {
                let _ = std::fs::remove_dir_all(&r);
            }
        }
    }
}

// ============================================
// File helpers
// ============================================

fn collect_files(dir: &Path) -> Vec<PathBuf> {
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

fn total_size(files: &[PathBuf]) -> u64 {
    files
        .iter()
        .filter_map(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .sum()
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "file".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Allow forward-slashes but reject parent traversal and absolute paths.
fn sanitize_relative_path(p: &str) -> String {
    let normalized = p.replace('\\', "/");
    let parts: Vec<&str> = normalized
        .split('/')
        .filter(|seg| !seg.is_empty() && *seg != "." && *seg != "..")
        .collect();
    if parts.is_empty() {
        return "file".to_string();
    }
    parts
        .iter()
        .map(|p| sanitize_filename(p))
        .collect::<Vec<_>>()
        .join("/")
}

// ============================================
// Main ZIP operation
// ============================================

pub async fn compress_zip(app: &AppHandle, opts: ZipOptions) -> Result<CompressResult> {
    let source_path = PathBuf::from(&opts.source);
    if !source_path.exists() {
        return Ok(CompressResult {
            success: false,
            output_path: String::new(),
            output_info: None,
            error: Some("Source introuvable".to_string()),
        });
    }

    let folder_name = source_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "archive".to_string());

    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| String::from("."));
    let out_dir = opts
        .output_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(&user_profile)
                .join("Videos")
                .join("LoadLink-Videos")
        });
    std::fs::create_dir_all(&out_dir)?;
    let zip_path = out_dir.join(format!("[ZIP] {}.zip", folder_name));

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

    let files = collect_files(&source_path);
    let total_files = files.len() as u32;
    let total_bytes = total_size(&files);

    let app_clone = app.clone();
    let zip_path_clone = zip_path.clone();
    let source_clone = source_path.clone();
    let level = opts.level;

    let result = tokio::task::spawn_blocking(move || -> std::result::Result<u64, String> {
        use std::fs::File;
        use std::io::{Read, Write};
        use zip::write::FileOptions;
        use zip::CompressionMethod;

        let file = File::create(&zip_path_clone).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);

        let method = if level == 0 {
            CompressionMethod::Stored
        } else {
            CompressionMethod::Deflated
        };
        let options: FileOptions<()> = FileOptions::default()
            .compression_method(method)
            .compression_level(if level == 0 { None } else { Some(level as i64) })
            .unix_permissions(0o755);

        let base = if source_clone.is_dir() {
            source_clone.clone()
        } else {
            source_clone
                .parent()
                .unwrap_or(Path::new("."))
                .to_path_buf()
        };

        const CHUNK_SIZE: usize = 1024 * 1024;
        let mut chunk = vec![0u8; CHUNK_SIZE];
        let mut bytes_processed: u64 = 0;
        let mut last_emit = Instant::now();

        for (i, path) in files.iter().enumerate() {
            let rel = path.strip_prefix(&base).unwrap_or(path);
            let name = rel.to_string_lossy().replace('\\', "/");

            let percent = if total_bytes > 0 {
                (bytes_processed as f32 / total_bytes as f32) * 100.0
            } else {
                0.0
            };
            let _ = app_clone.emit(
                "compress-progress",
                CompressProgress {
                    percent: percent.min(99.0),
                    stage: "zipping".to_string(),
                    current_file: Some(name.clone()),
                    file_index: Some(i as u32 + 1),
                    total_files: Some(total_files),
                },
            );
            last_emit = Instant::now();

            zip.start_file(&name, options).map_err(|e| e.to_string())?;
            let mut f = File::open(path).map_err(|e| e.to_string())?;

            loop {
                let n = f.read(&mut chunk).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                zip.write_all(&chunk[..n]).map_err(|e| e.to_string())?;
                bytes_processed += n as u64;

                if last_emit.elapsed().as_millis() >= 100 {
                    let percent = if total_bytes > 0 {
                        (bytes_processed as f32 / total_bytes as f32) * 100.0
                    } else {
                        0.0
                    };
                    let _ = app_clone.emit(
                        "compress-progress",
                        CompressProgress {
                            percent: percent.min(99.0),
                            stage: "zipping".to_string(),
                            current_file: Some(name.clone()),
                            file_index: Some(i as u32 + 1),
                            total_files: Some(total_files),
                        },
                    );
                    last_emit = Instant::now();
                }
            }
        }

        zip.finish().map_err(|e| e.to_string())?;
        Ok(std::fs::metadata(&zip_path_clone)
            .map(|m| m.len())
            .unwrap_or(0))
    })
    .await
    .map_err(|e| LoadlinkError::Other(e.to_string()))?;

    match result {
        Ok(size) => {
            let info = format!("Archive : {:.1} Mo", size as f64 / 1_048_576.0);
            let _ = app.emit(
                "compress-progress",
                CompressProgress {
                    percent: 100.0,
                    stage: "zipping".to_string(),
                    current_file: None,
                    file_index: Some(total_files),
                    total_files: Some(total_files),
                },
            );
            Ok(CompressResult {
                success: true,
                output_path: zip_path.to_string_lossy().to_string(),
                output_info: Some(info),
                error: None,
            })
        }
        Err(e) => Ok(CompressResult {
            success: false,
            output_path: String::new(),
            output_info: None,
            error: Some(e),
        }),
    }
}

// ============================================
// Drag & drop — small files (base64 in memory)
// ============================================

pub async fn compress_dropped_files(
    app: &AppHandle,
    opts: DroppedFilesOptions,
) -> Result<CompressResult> {
    if opts.files.is_empty() {
        return Ok(CompressResult {
            success: false,
            output_path: String::new(),
            output_info: None,
            error: Some("Aucun fichier reçu".to_string()),
        });
    }

    let temp_root = std::env::temp_dir();
    let session_id = Uuid::new_v4().to_string();
    let archive_name = opts
        .archive_name
        .clone()
        .unwrap_or_else(|| format!("drop-{}", &session_id[..8]));
    let temp_dir = temp_root.join(format!("loadlink-drop-{}", &session_id[..12]));

    if let Err(e) = std::fs::create_dir_all(&temp_dir) {
        return Ok(CompressResult {
            success: false,
            output_path: String::new(),
            output_info: None,
            error: Some(format!("Impossible de créer le dossier temporaire : {}", e)),
        });
    }

    let working_dir = temp_dir.join(&archive_name);
    if let Err(e) = std::fs::create_dir_all(&working_dir) {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Ok(CompressResult {
            success: false,
            output_path: String::new(),
            output_info: None,
            error: Some(format!("Impossible de créer le sous-dossier : {}", e)),
        });
    }

    let total_files = opts.files.len();
    for (i, file) in opts.files.iter().enumerate() {
        let percent = (i as f32 / total_files as f32) * 5.0;
        let _ = app.emit(
            "compress-progress",
            CompressProgress {
                percent,
                stage: "scanning".to_string(),
                current_file: Some(file.filename.clone()),
                file_index: Some((i + 1) as u32),
                total_files: Some(total_files as u32),
            },
        );

        let safe_rel = sanitize_relative_path(&file.filename);
        let target_path = working_dir.join(&safe_rel);
        if let Some(parent) = target_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let bytes = match B64.decode(file.data.as_bytes()) {
            Ok(b) => b,
            Err(e) => {
                let _ = std::fs::remove_dir_all(&temp_dir);
                return Ok(CompressResult {
                    success: false,
                    output_path: String::new(),
                    output_info: None,
                    error: Some(format!("Décodage échoué pour {}: {}", safe_rel, e)),
                });
            }
        };

        if let Err(e) = std::fs::write(&target_path, &bytes) {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Ok(CompressResult {
                success: false,
                output_path: String::new(),
                output_info: None,
                error: Some(format!("Écriture échouée pour {}: {}", safe_rel, e)),
            });
        }
    }

    let zip_opts = ZipOptions {
        source: working_dir.to_string_lossy().to_string(),
        output_dir: opts.output_dir,
        level: opts.level,
    };

    let result = compress_zip(app, zip_opts).await;
    let _ = std::fs::remove_dir_all(&temp_dir);
    result
}

// ============================================
// Drag & drop — large files (chunked streaming)
// ============================================

/// Compress files that were uploaded via the chunked upload API.
/// All files share the same temp_root (the session dir).
/// We compress the entire session dir so the archive name is meaningful.
pub async fn compress_chunked_session(
    app: &AppHandle,
    state: &ChunkedUploadState,
    upload_ids: Vec<String>,
    output_dir: Option<String>,
    level: i32,
    archive_name: Option<String>,
) -> Result<CompressResult> {
    let (temp_root, entries) = match state.finalize_session(&upload_ids) {
        Ok(v) => v,
        Err(e) => {
            state.cleanup();
            return Ok(CompressResult {
                success: false,
                output_path: String::new(),
                output_info: None,
                error: Some(e),
            });
        }
    };

    if entries.is_empty() {
        state.cleanup();
        return Ok(CompressResult {
            success: false,
            output_path: String::new(),
            output_info: None,
            error: Some("Aucun fichier uploadé".to_string()),
        });
    }

    // If an archive_name was given, rename the temp root before compressing
    // so the inner folder name and ZIP name match.
    let final_source = if let Some(name) = archive_name.as_ref() {
        let safe = sanitize_filename(name);
        let parent = temp_root.parent().unwrap_or(Path::new("."));
        let renamed = parent.join(format!("loadlink-{}", safe));
        match std::fs::rename(&temp_root, &renamed) {
            Ok(_) => renamed,
            Err(_) => temp_root.clone(), // fallback if rename fails
        }
    } else {
        temp_root.clone()
    };

    let zip_opts = ZipOptions {
        source: final_source.to_string_lossy().to_string(),
        output_dir,
        level,
    };

    let result = compress_zip(app, zip_opts).await;

    // Clean up
    let _ = std::fs::remove_dir_all(&final_source);
    state.cleanup();

    result
}