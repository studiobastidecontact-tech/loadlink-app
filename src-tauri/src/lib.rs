//! # LoadLink — Main Tauri orchestrator

use loadlink_audio_master::{
    analyze as audio_analyze_run, apply_preset as audio_apply_preset_run,
    list_presets as audio_list_presets_run, AudioAnalysis, AudioPresetInfo, AudioPresetOptions,
    AudioProcessResult,
};
use loadlink_compressor::{
    compress_chunked_session, compress_dropped_files as compressor_dropped,
    compress_zip as compressor_zip, ChunkedUploadState, DroppedFile, DroppedFilesOptions,
    ZipOptions,
};
use loadlink_converter::{
    convert_files_batch as converter_batch, find_libreoffice,
    reencode_videos as converter_reencode, ConvertBatchOptions, ConvertFileEntry, ConvertResult,
    ReencodeOptions,
};
use loadlink_core::{CompressResult, DownloadResult, UpdateResult, VideoInfo};
use loadlink_importer::{
    download as importer_download, fetch_info as importer_fetch_info,
    update_ytdlp as importer_update_ytdlp, DownloadOptions,
};
use loadlink_job_manager::{Job, JobKind, JobManager, JobState};
use loadlink_transcriber::{transcribe as transcriber_run, TranscribeOptions, TranscribeResult};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::process::Command;

// ============================================
// State
// ============================================

struct AppState {
    job_manager: Arc<JobManager>,
    chunked_upload: ChunkedUploadState,
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

    let title = format!("Download — {}", url);
    let mut job = Job::new(JobKind::Download, title);
    job.input_path = Some(url.clone());
    job.metadata = serde_json::json!({ "format": format });
    let job_id = job.id;

    if let Err(e) = state.job_manager.insert(&job) {
        tracing::warn!("Failed to insert job: {}", e);
    }

    let _ = state
        .job_manager
        .update_state(job_id, JobState::Running, 0.0, None, None);

    let result = importer_download(&app, opts).await;

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

// ============================================
// Phase 2: drag & drop — small files
// ============================================

#[tauri::command]
async fn compress_files_from_data(
    app: AppHandle,
    state: State<'_, AppState>,
    files: Vec<DroppedFile>,
    output_dir: Option<String>,
    level: i32,
    archive_name: Option<String>,
) -> Result<CompressResult, String> {
    let title = format!("ZIP (drop) — {} fichiers", files.len());
    let mut job = Job::new(JobKind::CompressZip, title);
    job.input_path = Some(format!("<dropped:{}>", files.len()));
    let job_id = job.id;
    let _ = state.job_manager.insert(&job);
    let _ = state
        .job_manager
        .update_state(job_id, JobState::Running, 0.0, None, None);

    let opts = DroppedFilesOptions {
        files,
        output_dir,
        level,
        archive_name,
    };

    let result = compressor_dropped(&app, opts).await;

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

// ============================================
// Phase 2: drag & drop — chunked streaming
// ============================================

#[tauri::command]
async fn chunked_upload_start(
    state: State<'_, AppState>,
    relative_path: String,
) -> Result<String, String> {
    state.chunked_upload.start(&relative_path)
}

#[tauri::command]
async fn chunked_upload_append(
    state: State<'_, AppState>,
    upload_id: String,
    chunk: String,
) -> Result<u64, String> {
    state.chunked_upload.append(&upload_id, &chunk)
}

#[tauri::command]
async fn chunked_upload_compress(
    app: AppHandle,
    state: State<'_, AppState>,
    upload_ids: Vec<String>,
    output_dir: Option<String>,
    level: i32,
    archive_name: Option<String>,
) -> Result<CompressResult, String> {
    let title = format!("ZIP (chunked) — {} fichiers", upload_ids.len());
    let mut job = Job::new(JobKind::CompressZip, title);
    job.input_path = Some(format!("<chunked:{}>", upload_ids.len()));
    let job_id = job.id;
    let _ = state.job_manager.insert(&job);
    let _ = state
        .job_manager
        .update_state(job_id, JobState::Running, 0.0, None, None);

    let chunked_state = state.chunked_upload.clone();
    let result = compress_chunked_session(
        &app,
        &chunked_state,
        upload_ids,
        output_dir,
        level,
        archive_name,
    )
    .await;

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
async fn chunked_upload_cancel(state: State<'_, AppState>) -> Result<(), String> {
    state.chunked_upload.cleanup();
    Ok(())
}

// ============================================
// Reencode (Compresser module — H.265 video reencoding)
// ============================================

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

// ============================================
// PHASE 3: Convertir module
// ============================================

#[tauri::command]
async fn convert_files_batch(
    app: AppHandle,
    state: State<'_, AppState>,
    files: Vec<ConvertFileEntry>,
    output_dir: Option<String>,
) -> Result<ConvertResult, String> {
    let title = format!("Convert — {} fichiers", files.len());
    let mut job = Job::new(JobKind::Reencode, title);
    job.input_path = Some(format!("<batch:{}>", files.len()));
    let job_id = job.id;
    let _ = state.job_manager.insert(&job);
    let _ = state
        .job_manager
        .update_state(job_id, JobState::Running, 0.0, None, None);

    let opts = ConvertBatchOptions { files, output_dir };
    let result = converter_batch(&app, opts).await;

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
async fn check_libreoffice() -> Result<bool, String> {
    Ok(find_libreoffice().is_some())
}

// ============================================
// Phase 4 Transcrire
// ============================================

#[tauri::command]
async fn transcribe(
    app: AppHandle,
    state: State<'_, AppState>,
    input: String,
    output_dir: Option<String>,
    model: String,
    language: Option<String>,
    formats: Vec<String>,
    translate_to_english: Option<bool>,
) -> Result<TranscribeResult, String> {
    let opts = TranscribeOptions {
        input: input.clone(),
        output_dir,
        model: model.clone(),
        language,
        formats,
        translate_to_english: translate_to_english.unwrap_or(false),
    };

    let display_name = std::path::Path::new(&input)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| input.clone());
    let title = format!("Transcription -- {} ({})", display_name, model);
    let mut job = Job::new(JobKind::Transcribe, title);
    job.input_path = Some(input);
    let job_id = job.id;

    if let Err(e) = state.job_manager.insert(&job) {
        tracing::warn!("Failed to insert transcribe job: {}", e);
    }
    let _ = state
        .job_manager
        .update_state(job_id, JobState::Running, 0.0, None, None);

    let result = transcriber_run(&app, opts).await;

    match &result {
        Ok(r) if r.success => {
            let _ = state.job_manager.update_state(
                job_id,
                JobState::Completed,
                100.0,
                None,
                r.output_files.first().cloned(),
            );
        }
        Ok(r) => {
            let _ = state.job_manager.update_state(
                job_id,
                JobState::Failed,
                0.0,
                r.error.clone(),
                None,
            );
        }
        Err(e) => {
            let _ = state.job_manager.update_state(
                job_id,
                JobState::Failed,
                0.0,
                Some(e.clone()),
                None,
            );
        }
    }

    result
}

// ============================================
// Phase A Audio Master
// ============================================

#[tauri::command]
async fn audio_list_presets() -> Result<Vec<AudioPresetInfo>, String> {
    Ok(audio_list_presets_run())
}

#[tauri::command]
async fn audio_analyze(app: AppHandle, input: String) -> Result<AudioAnalysis, String> {
    audio_analyze_run(&app, input)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn audio_apply_preset(
    app: AppHandle,
    state: State<'_, AppState>,
    input: String,
    output_dir: Option<String>,
    preset: String,
    format: Option<String>,
) -> Result<AudioProcessResult, String> {
    let display_name = std::path::Path::new(&input)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| input.clone());
    let title = format!("Audio -- {} ({})", display_name, preset);
    let mut job = Job::new(JobKind::AudioProcess, title);
    job.input_path = Some(input.clone());
    job.metadata = serde_json::json!({
        "preset": preset.clone(),
        "format": format.clone(),
    });
    let job_id = job.id;

    if let Err(e) = state.job_manager.insert(&job) {
        tracing::warn!("Failed to insert audio job: {}", e);
    }
    let _ = state
        .job_manager
        .update_state(job_id, JobState::Running, 0.0, None, None);

    let opts = AudioPresetOptions {
        input,
        output_dir,
        preset,
        format,
    };
    let result = audio_apply_preset_run(&app, opts).await;

    match &result {
        Ok(r) if r.success => {
            let _ = state.job_manager.update_state(
                job_id,
                JobState::Completed,
                100.0,
                None,
                Some(r.output_path.clone()),
            );
        }
        Ok(r) => {
            let _ = state.job_manager.update_state(
                job_id,
                JobState::Failed,
                0.0,
                r.error.clone(),
                None,
            );
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
        }
    }

    result.map_err(|e| e.to_string())
}
// ============================================
// Misc commands
// ============================================

#[tauri::command]
async fn update_ytdlp(app: AppHandle) -> Result<UpdateResult, String> {
    importer_update_ytdlp(&app).await.map_err(|e| e.to_string())
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

#[tauri::command]
async fn open_converted_folder() -> Result<(), String> {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    let folder = PathBuf::from(&user_profile)
        .join("Videos")
        .join("LoadLink-Converted");
    std::fs::create_dir_all(&folder).ok();
    open_folder(folder.to_string_lossy().to_string()).await
}

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
// ============================================
// Phase 4.5 - Player (Lire)
// ============================================

/// Lit le contenu d'un fichier texte (utilise pour parser les SRT cote JS)
#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Lecture impossible : {}", e))
}

/// Ecrit du contenu texte dans un fichier (utilise pour sauvegarder un SRT edite)
#[tauri::command]
async fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("Ecriture impossible : {}", e))
}
pub fn run() {
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
            let job_manager =
                Arc::new(JobManager::new(&app.handle()).expect("Failed to initialize JobManager"));
            let _ = job_manager.cleanup_old(30);
            app.manage(AppState {
                job_manager,
                chunked_upload: ChunkedUploadState::new(),
            });
            tracing::info!("LoadLink started, JobManager initialized");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Existing commands
            fetch_video_info,
            download_video,
            compress_zip,
            reencode_videos,
            update_ytdlp,
            open_folder,
            open_default_folder,
            list_recent_jobs,
            cleanup_old_jobs,
            // Phase 2 drag & drop — small files
            compress_files_from_data,
            // Phase 2 drag & drop — chunked streaming
            chunked_upload_start,
            chunked_upload_append,
            chunked_upload_compress,
            chunked_upload_cancel,
            // Phase 3 Convertir
            convert_files_batch,
            check_libreoffice,
            open_converted_folder,
            // Phase 4 Transcrire
            transcribe,
            // Phase A Audio Master
            audio_list_presets,
            audio_analyze,
            audio_apply_preset,
            // Phase 4.5 Lire (player)
            read_text_file,
            write_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
