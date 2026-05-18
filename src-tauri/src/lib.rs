//! # LoadLink — Main Tauri orchestrator
//!
//! This file is intentionally **small**. All business logic lives in the
//! `crates/*` workspace members. This file only:
//! 1. Registers Tauri plugins
//! 2. Initializes shared state (JobManager)
//! 3. Exposes Tauri commands that delegate to the modular crates
//!
//! If you find yourself writing more than 20 lines of logic here,
//! it probably belongs in a crate instead.

use loadlink_compressor::{compress_zip as compressor_zip, ZipOptions};
use loadlink_converter::{reencode_videos as converter_reencode, ReencodeOptions};
use loadlink_core::{
    CompressResult, DownloadResult, ProgressUpdate, UpdateResult, VideoInfo,
};
use loadlink_importer::{
    download as importer_download, fetch_info as importer_fetch_info,
    update_ytdlp as importer_update_ytdlp, DownloadOptions,
};
use loadlink_job_manager::{Job, JobKind, JobManager, JobState};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::process::Command;

// ============================================
// State
// ============================================

/// Shared application state, accessible from any Tauri command.
struct AppState {
    job_manager: Arc<JobManager>,
}

// ============================================
// Tauri commands
// ============================================

#[tauri::command]
async fn fetch_video_info(app: AppHandle, url: String) -> Result<VideoInfo, String> {
    importer_fetch_info(&app, &url)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn download_video(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    format: String,
    quality: String,
    custom_name: Option<String>,
    custom_dir: Option<String>,
    is_playlist: Option<bool>,
) -> Result<DownloadResult, String> {
    let opts = DownloadOptions {
        url: url.clone(),
        format: format.clone(),
        quality,
        custom_name,
        custom_dir,
        is_playlist: is_playlist.unwrap_or(false),
    };

    // Create a Job entry for tracking/history
    let title = format!("Download — {}", url);
    let mut job = Job::new(JobKind::Download, title);
    job.input_path = Some(url.clone());
    job.metadata = serde_json::json!({ "format": format });
    let job_id = job.id;

    if let Err(e) = state.job_manager.insert(&job) {
        tracing::warn!("Failed to insert job: {}", e);
    }

    // Mark as Running
    let _ = state
        .job_manager
        .update_state(job_id, JobState::Running, 0.0, None, None);

    // Execute
    let result = importer_download(&app, opts).await;

    // Update final state
    match &result {
        Ok(file_path) => {
            let _ = state.job_manager.update_state(
                job_id,
                JobState::Completed,
                100.0,
                None,
                Some(file_path.clone()),
            );
            Ok(DownloadResult {
                success: true,
                file_path: file_path.clone(),
                error: None,
            })
        }
        Err(e) => {
            let err = e.to_string();
            let _ = state.job_manager.update_state(
                job_id,
                JobState::Failed,
                0.0,
                Some(err.clone()),
                None,
            );
            Ok(DownloadResult {
                success: false,
                file_path: String::new(),
                error: Some(err),
            })
        }
    }
}

#[tauri::command]
async fn compress_zip(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
    output_dir: Option<String>,
    level: i32,
) -> Result<CompressResult, String> {
    let opts = ZipOptions {
        source: source.clone(),
        output_dir,
        level,
    };

    let title = format!("ZIP — {}", source);
    let mut job = Job::new(JobKind::CompressZip, title);
    job.input_path = Some(source.clone());
    let job_id = job.id;
    let _ = state.job_manager.insert(&job);
    let _ = state
        .job_manager
        .update_state(job_id, JobState::Running, 0.0, None, None);

    let result = compressor_zip(&app, opts).await;

    match result {
        Ok(r) => {
            if r.success {
                let _ = state.job_manager.update_state(
                    job_id,
                    JobState::Completed,
                    100.0,
                    None,
                    Some(r.output_path.clone()),
                );
            } else {
                let _ = state.job_manager.update_state(
                    job_id,
                    JobState::Failed,
                    0.0,
                    r.error.clone(),
                    None,
                );
            }
            Ok(r)
        }
        Err(e) => {
            let err = e.to_string();
            let _ = state.job_manager.update_state(
                job_id,
                JobState::Failed,
                0.0,
                Some(err.clone()),
                None,
            );
            Err(err)
        }
    }
}

#[tauri::command]
async fn reencode_videos(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
    output_dir: Option<String>,
    mode: String,
    crf: i32,
    bitrate_ratio: f32,
) -> Result<CompressResult, String> {
    let opts = ReencodeOptions {
        source: source.clone(),
        output_dir,
        mode,
        crf,
        bitrate_ratio,
    };

    let title = format!("Reencode — {}", source);
    let mut job = Job::new(JobKind::Reencode, title);
    job.input_path = Some(source.clone());
    let job_id = job.id;
    let _ = state.job_manager.insert(&job);
    let _ = state
        .job_manager
        .update_state(job_id, JobState::Running, 0.0, None, None);

    let result = converter_reencode(&app, opts).await;

    match result {
        Ok(r) => {
            if r.success {
                let _ = state.job_manager.update_state(
                    job_id,
                    JobState::Completed,
                    100.0,
                    None,
                    Some(r.output_path.clone()),
                );
            } else {
                let _ = state.job_manager.update_state(
                    job_id,
                    JobState::Failed,
                    0.0,
                    r.error.clone(),
                    None,
                );
            }
            Ok(r)
        }
        Err(e) => {
            let err = e.to_string();
            let _ = state.job_manager.update_state(
                job_id,
                JobState::Failed,
                0.0,
                Some(err.clone()),
                None,
            );
            Err(err)
        }
    }
}

#[tauri::command]
async fn update_ytdlp(app: AppHandle) -> Result<UpdateResult, String> {
    importer_update_ytdlp(&app)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn open_default_folder(is_audio: bool) -> Result<(), String> {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    let folder = if is_audio {
        PathBuf::from(&user_profile)
            .join("Music")
            .join("LoadLink-Audio")
    } else {
        PathBuf::from(&user_profile)
            .join("Videos")
            .join("LoadLink-Videos")
    };
    std::fs::create_dir_all(&folder).ok();
    open_folder(folder.to_string_lossy().to_string()).await
}

// ============================================
// New commands enabled by JobManager (Phase 1 feature)
// ============================================

#[tauri::command]
async fn list_recent_jobs(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<Job>, String> {
    state
        .job_manager
        .recent(limit.unwrap_or(20))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cleanup_old_jobs(state: State<'_, AppState>, days: i64) -> Result<usize, String> {
    state
        .job_manager
        .cleanup_old(days)
        .map_err(|e| e.to_string())
}

// ============================================
// Tauri entry point
// ============================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Init structured logging (only writes to stderr — no log file in dev)
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,loadlink=debug")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Initialize the JobManager (creates jobs.db in AppData if needed)
            let job_manager = Arc::new(
                JobManager::new(&app.handle())
                    .expect("Failed to initialize JobManager"),
            );

            // Clean up jobs older than 30 days on startup (best effort)
            let _ = job_manager.cleanup_old(30);

            app.manage(AppState { job_manager });

            tracing::info!("LoadLink started, JobManager initialized");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Existing commands (refactored)
            fetch_video_info,
            download_video,
            compress_zip,
            reencode_videos,
            update_ytdlp,
            open_folder,
            open_default_folder,
            // New commands (Phase 1)
            list_recent_jobs,
            cleanup_old_jobs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
