// loadlink-transcriber: Whisper-based audio/video transcription via Python embeddable
//
// Phase 4 - Module Transcrire
// Wraps faster-whisper running in a bundled Python 3.11 embeddable.
// Inputs: audio file, video file, or YouTube URL.
// Outputs: TXT, SRT, VTT, JSON.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscribeOptions {
    /// Path to a local file OR a YouTube URL.
    pub input: String,
    /// Output directory; if None, defaults to same dir as input (or Documents/LoadLink-Transcriptions for URLs).
    pub output_dir: Option<String>,
    /// Whisper model name: "tiny", "base", "small", "medium", "large-v3".
    pub model: String,
    /// ISO 639-1 language code (e.g. "fr", "en"); None or "auto" for auto-detection.
    pub language: Option<String>,
    /// Output formats to generate: any subset of ["txt", "srt", "vtt", "json"].
    pub formats: Vec<String>,
    /// If true, translate to English instead of transcribing in source language.
    pub translate_to_english: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TranscribeResult {
    pub success: bool,
    /// Absolute paths of the generated output files.
    pub output_files: Vec<String>,
    /// Language detected by Whisper.
    pub language_detected: Option<String>,
    /// Audio duration in seconds.
    pub duration_seconds: Option<f64>,
    /// Error message if success == false.
    pub error: Option<String>,
}

/// Locate the bundled Python embeddable interpreter.
pub fn resolve_python_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir.join("binaries").join("python").join("python.exe");
        if prod_path.exists() {
            return Ok(prod_path);
        }
    }

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
/// Spawns the bundled Python (binaries/python/python.exe) running scripts/whisper_runner.py
/// with the given options. Streams JSON events on stdout, which are forwarded to the
/// frontend via Tauri events:
///   - "transcribe-progress"  { type, stage, pct }
///   - "transcribe-file"      { type, path }
///   - "transcribe-result"    final result (also returned by this function)
pub async fn transcribe(
    app: &AppHandle,
    opts: TranscribeOptions,
) -> Result<TranscribeResult, String> {
    let python_exe = resolve_python_path(app)?;
    let runner_script = resolve_runner_script(app)?;

    tracing::info!(
        "[transcribe] python={:?} script={:?} input={:?}",
        python_exe,
        runner_script,
        opts.input
    );

    // Build command
    let mut cmd = Command::new(&python_exe);
    cmd.arg(&runner_script)
        .arg("--input")
        .arg(&opts.input)
        .arg("--model")
        .arg(&opts.model)
        .arg("--formats")
        .arg(opts.formats.join(","));

    if let Some(dir) = &opts.output_dir {
        cmd.arg("--output-dir").arg(dir);
    }
    if let Some(lang) = &opts.language {
        if !lang.is_empty() && lang != "auto" {
            cmd.arg("--language").arg(lang);
        }
    }
    if opts.translate_to_english {
        cmd.arg("--translate");
    }

    // Pipe stdout/stderr
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    // Windows: hide the console window of the spawned process
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Python: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout pipe".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "no stderr pipe".to_string())?;

    // Spawn a task to drain stderr (just log it, don't block)
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut collected = String::new();
        while let Ok(Some(line)) = reader.next_line().await {
            tracing::warn!("[transcribe stderr] {}", line);
            collected.push_str(&line);
            collected.push('\n');
        }
        collected
    });

    // Read stdout line by line, parse JSON events, emit to frontend
    let mut reader = BufReader::new(stdout).lines();
    let mut final_result: Option<TranscribeResult> = None;

    while let Ok(Some(line)) = reader.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Try to parse as JSON event
        let event: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => {
                tracing::debug!("[transcribe non-json] {}", line);
                continue;
            }
        };

        let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match event_type {
            "progress" => {
                let _ = app.emit("transcribe-progress", &event);
            }
            "file_written" => {
                let _ = app.emit("transcribe-file", &event);
            }
            "result" => {
                // Store the result for return value
                let parsed: Result<TranscribeResult, _> = serde_json::from_value(event.clone());
                match parsed {
                    Ok(r) => {
                        final_result = Some(r.clone());
                        let _ = app.emit("transcribe-result", &event);
                    }
                    Err(e) => {
                        tracing::error!("[transcribe] cannot parse result event: {}", e);
                    }
                }
            }
            _ => {
                tracing::debug!("[transcribe unknown event] {}", line);
            }
        }
    }

    // Wait for the child process to exit
    let status = child
        .wait()
        .await
        .map_err(|e| format!("waiting for Python: {}", e))?;

    // Drain stderr task
    let stderr_collected = stderr_task.await.unwrap_or_default();

    match final_result {
        Some(r) => Ok(r),
        None => {
            // No result event received; treat as failure
            let err = if !stderr_collected.is_empty() {
                format!(
                    "Python a quitte sans emettre de result (exit={:?}). Stderr:\n{}",
                    status.code(),
                    stderr_collected
                )
            } else {
                format!("Python a quitte sans emettre de result (exit={:?})", status.code())
            };
            Ok(TranscribeResult {
                success: false,
                output_files: vec![],
                language_detected: None,
                duration_seconds: None,
                error: Some(err),
            })
        }
    }
}
