//! # loadlink-compressor
//!
//! ZIP archive creation with byte-level progress reporting.
//!
//! Wraps the `zip` crate with a progress-reporting interface
//! that emits events through Tauri.
//!
//! ## Progress reporting (v2)
//!
//! Progress is now reported BY BYTES (not by file count). This fixes the
//! "stuck at 1%" bug when compressing a single large file: previously, the
//! progress jumped from 0% to 100% with no intermediate updates during the
//! actual compression of each file. Now we emit progress events every chunk
//! (1 MB) so the user sees smooth progression.

use loadlink_core::{CompressProgress, CompressResult, LoadlinkError, Result};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

// ============================================
// Options
// ============================================

#[derive(Debug, Clone)]
pub struct ZipOptions {
    pub source: String,
    pub output_dir: Option<String>,
    /// 0 = stored (no compression), 1-9 = deflate levels (9 = max)
    pub level: i32,
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

// ============================================
// Main ZIP operation
// ============================================

/// Compresses a file or folder into a ZIP archive.
///
/// Reports progress via the `compress-progress` Tauri event.
/// Progress is calculated by bytes processed (not file count), so it updates
/// smoothly even when compressing a single large file.
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

    // Emit "scanning" event so the user sees something is happening
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

    // Run zipping in blocking task (zip crate is sync)
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

        // Chunk size: 1 MB. Balance between event spam and granular progress.
        const CHUNK_SIZE: usize = 1024 * 1024;
        let mut chunk = vec![0u8; CHUNK_SIZE];
        let mut bytes_processed: u64 = 0;
        // Rate-limit events: don't emit more than once per 100ms
        let mut last_emit = Instant::now();

        for (i, path) in files.iter().enumerate() {
            let rel = path.strip_prefix(&base).unwrap_or(path);
            let name = rel.to_string_lossy().replace('\\', "/");

            // Emit progress at file start (so the UI updates the filename)
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

            // Stream-copy file to zip in chunks, emitting progress along the way
            loop {
                let n = f.read(&mut chunk).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                zip.write_all(&chunk[..n]).map_err(|e| e.to_string())?;
                bytes_processed += n as u64;

                // Rate-limited progress emission (max 10/sec)
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