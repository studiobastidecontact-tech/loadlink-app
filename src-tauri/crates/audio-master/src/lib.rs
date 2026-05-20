//! # loadlink-audio-master
//!
//! Audio analysis and mastering presets for LoadLink.
//! Phase A intentionally keeps the surface small:
//! - inspect one audio/media file
//! - apply one preset to the first audio stream
//! - write a new output file without touching the source

use loadlink_core::{LoadlinkError, Result};
use loadlink_workers::{apply_no_window, get_ffmpeg_path};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const DEFAULT_SAMPLE_RATE: u32 = 48_000;
const AUDIO_OUTPUT_DIR_NAME: &str = "LoadLink-Audio";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPresetInfo {
    pub key: String,
    pub slug: String,
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioAnalysis {
    pub duration_seconds: Option<f64>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub loudness_lufs: Option<f32>,
    pub peak_dbfs: Option<f32>,
    pub has_clipping: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioProcessResult {
    pub success: bool,
    pub output_path: String,
    pub preset: String,
    pub output_info: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioProgress {
    pub percent: f32,
    pub stage: String,
    pub current_file: Option<String>,
    pub preset: Option<String>,
    pub output_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AudioPresetOptions {
    pub input: String,
    pub output_dir: Option<String>,
    pub preset: String,
    pub format: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioEffectChain {
    pub input: String,
    pub output_dir: Option<String>,
    pub format: Option<String>,
    pub effects: Vec<AudioEffect>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AudioEffect {
    Eq {
        enabled: bool,
        bands: Vec<EqBand>,
    },
    Compressor {
        enabled: bool,
        threshold: f32,
        ratio: f32,
        attack: f32,
        release: f32,
        makeup: f32,
    },
    DeEsser {
        enabled: bool,
        intensity: Option<f32>,
    },
    Denoise {
        enabled: bool,
        amount: Option<f32>,
    },
    Reverb {
        enabled: bool,
    },
    Limiter {
        enabled: bool,
    },
    Silence {
        enabled: bool,
        threshold: Option<f32>,
        duration: Option<f32>,
    },
    Loudnorm {
        enabled: bool,
        target_lufs: f32,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqBand {
    pub kind: String,
    pub freq: f32,
    pub gain: f32,
    pub q: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioPreset {
    ClearVoice,
    VoiceMemo,
    PodcastInterview,
}

impl AudioPreset {
    pub fn all() -> [Self; 3] {
        [Self::ClearVoice, Self::VoiceMemo, Self::PodcastInterview]
    }

    pub fn from_key(key: &str) -> Option<Self> {
        match key {
            "clear_voice" | "clear-voice" => Some(Self::ClearVoice),
            "voice_memo" | "voice-memo" => Some(Self::VoiceMemo),
            "podcast_interview" | "podcast-interview" => Some(Self::PodcastInterview),
            _ => None,
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::ClearVoice => "clear_voice",
            Self::VoiceMemo => "voice_memo",
            Self::PodcastInterview => "podcast_interview",
        }
    }

    pub fn slug(self) -> &'static str {
        match self {
            Self::ClearVoice => "clear-voice",
            Self::VoiceMemo => "voice-memo",
            Self::PodcastInterview => "podcast-interview",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::ClearVoice => "Voix claire",
            Self::VoiceMemo => "Note vocale lisible",
            Self::PodcastInterview => "Podcast / Interview",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::ClearVoice => {
                "Nettoyage leger, presence voix, compression naturelle et loudness web."
            }
            Self::VoiceMemo => {
                "Nettoyage plus ferme pour rendre une note vocale mobile plus lisible."
            }
            Self::PodcastInterview => {
                "Traitement stable pour voix longue, interview et diffusion podcast."
            }
        }
    }

    pub fn filter_chain(self, target_sample_rate: u32) -> String {
        let base = match self {
            Self::ClearVoice => [
                "highpass=f=80",
                "afftdn=nf=-25",
                "equalizer=f=3000:t=q:w=1:g=3",
                "equalizer=f=180:t=q:w=1:g=-2",
                "acompressor=threshold=-18dB:ratio=3:attack=5:release=80:makeup=2",
                "loudnorm=I=-16:TP=-1.5:LRA=11",
            ]
            .join(","),
            Self::VoiceMemo => [
                "highpass=f=100",
                "afftdn=nf=-30",
                "equalizer=f=250:t=q:w=1:g=-3",
                "equalizer=f=3500:t=q:w=1:g=4",
                "acompressor=threshold=-22dB:ratio=4:attack=3:release=100:makeup=3",
                "loudnorm=I=-15:TP=-1.5:LRA=9",
            ]
            .join(","),
            Self::PodcastInterview => [
                "highpass=f=75",
                "afftdn=nf=-22",
                "deesser=i=0.35:m=0.5:f=0.55:s=o",
                "equalizer=f=120:t=q:w=0.8:g=-1.5",
                "equalizer=f=4500:t=q:w=1:g=2",
                "acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=2",
                "loudnorm=I=-16:TP=-1.5:LRA=11",
            ]
            .join(","),
        };

        format!("{base},aresample={target_sample_rate},alimiter=limit=0.95")
    }

    pub fn info(self) -> AudioPresetInfo {
        AudioPresetInfo {
            key: self.key().to_string(),
            slug: self.slug().to_string(),
            label: self.label().to_string(),
            description: self.description().to_string(),
        }
    }
}

pub fn list_presets() -> Vec<AudioPresetInfo> {
    AudioPreset::all()
        .into_iter()
        .map(AudioPreset::info)
        .collect()
}

pub async fn analyze(app: &AppHandle, input: String) -> Result<AudioAnalysis> {
    let ffmpeg = get_ffmpeg_path(app)?;
    let source = PathBuf::from(input);
    ensure_source_exists(&source)?;

    let mut cmd = Command::new(&ffmpeg);
    cmd.arg("-hide_banner")
        .arg("-i")
        .arg(&source)
        .arg("-vn")
        .arg("-map")
        .arg("0:a:0")
        .arg("-af")
        .arg("astats=metadata=1:reset=0,ebur128=peak=true")
        .arg("-f")
        .arg("null")
        .arg("-");
    cmd.stdout(Stdio::null()).stderr(Stdio::piped());
    apply_no_window(&mut cmd);

    let output = cmd
        .output()
        .await
        .map_err(|e| LoadlinkError::SpawnFailed(format!("ffmpeg analyze: {e}")))?;
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(LoadlinkError::Other(ffmpeg_error(&stderr)));
    }

    Ok(parse_analysis(&stderr))
}

pub async fn apply_preset(app: &AppHandle, opts: AudioPresetOptions) -> Result<AudioProcessResult> {
    let ffmpeg = get_ffmpeg_path(app)?;
    let source = PathBuf::from(&opts.input);
    ensure_source_exists(&source)?;

    let preset = AudioPreset::from_key(&opts.preset).ok_or_else(|| {
        LoadlinkError::InvalidArgument(format!("Preset audio inconnu: {}", opts.preset))
    })?;

    let probe = probe_input(&ffmpeg, &source).await?;
    let target_sample_rate = probe.sample_rate.unwrap_or(DEFAULT_SAMPLE_RATE);
    let output_format = normalize_output_format(opts.format.as_deref(), &source)?;
    let out_dir = resolve_output_dir(&source, opts.output_dir.as_deref())?;
    std::fs::create_dir_all(&out_dir)?;
    let out_path = unique_output_path(&source, &out_dir, preset.slug(), &output_format);
    let filter_chain = preset.filter_chain(target_sample_rate);
    let source_name = display_name(&source);

    emit_progress(
        app,
        0.0,
        "preparing",
        Some(source_name.clone()),
        Some(preset),
        None,
    );

    let mut cmd = Command::new(&ffmpeg);
    cmd.arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(&source)
        .arg("-map")
        .arg("0:a:0")
        .arg("-vn")
        .arg("-af")
        .arg(&filter_chain);
    append_codec_args(&mut cmd, &output_format);
    cmd.arg("-progress")
        .arg("pipe:1")
        .arg("-nostats")
        .arg(&out_path);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    apply_no_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| LoadlinkError::SpawnFailed(format!("ffmpeg audio preset: {e}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| LoadlinkError::Other("ffmpeg stdout indisponible".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| LoadlinkError::Other("ffmpeg stderr indisponible".to_string()))?;

    let app_for_progress = app.clone();
    let source_for_progress = source_name.clone();
    let preset_for_progress = preset;
    let duration = probe.duration_seconds.unwrap_or(0.0);
    let out_path_string = out_path.to_string_lossy().to_string();

    let progress_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let time_re = Regex::new(r"out_time_(?:ms|us)=(\d+)").unwrap();
        while let Ok(Some(line)) = reader.next_line().await {
            if let Some(captures) = time_re.captures(&line) {
                let micros = captures
                    .get(1)
                    .and_then(|m| m.as_str().parse::<f64>().ok())
                    .unwrap_or(0.0);
                let processed = micros / 1_000_000.0;
                let percent = if duration > 0.0 {
                    ((processed / duration) * 100.0).min(99.0) as f32
                } else {
                    50.0
                };
                emit_progress(
                    &app_for_progress,
                    percent,
                    "processing",
                    Some(source_for_progress.clone()),
                    Some(preset_for_progress),
                    Some(out_path_string.clone()),
                );
            }
        }
    });

    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut collected = String::new();
        while let Ok(Some(line)) = reader.next_line().await {
            collected.push_str(&line);
            collected.push('\n');
        }
        collected
    });

    let status = child
        .wait()
        .await
        .map_err(|e| LoadlinkError::Other(format!("ffmpeg wait: {e}")))?;
    let _ = progress_task.await;
    let stderr_collected = stderr_task.await.unwrap_or_default();

    if !status.success() {
        let _ = std::fs::remove_file(&out_path);
        let err = ffmpeg_error(&stderr_collected);
        emit_progress(app, 0.0, "failed", Some(source_name), Some(preset), None);
        return Ok(AudioProcessResult {
            success: false,
            output_path: String::new(),
            preset: preset.key().to_string(),
            output_info: None,
            error: Some(err),
        });
    }

    emit_progress(
        app,
        100.0,
        "completed",
        Some(source_name),
        Some(preset),
        Some(out_path.to_string_lossy().to_string()),
    );

    let output_info = std::fs::metadata(&out_path)
        .ok()
        .map(|m| format!("Fichier audio: {:.1} Mo", m.len() as f64 / 1_048_576.0));

    Ok(AudioProcessResult {
        success: true,
        output_path: out_path.to_string_lossy().to_string(),
        preset: preset.key().to_string(),
        output_info,
        error: None,
    })
}

pub async fn apply_chain(app: &AppHandle, opts: AudioEffectChain) -> Result<AudioProcessResult> {
    let ffmpeg = get_ffmpeg_path(app)?;
    let source = PathBuf::from(&opts.input);
    ensure_source_exists(&source)?;

    let probe = probe_input(&ffmpeg, &source).await?;
    let target_sample_rate = probe.sample_rate.unwrap_or(DEFAULT_SAMPLE_RATE);
    let output_format = normalize_output_format(opts.format.as_deref(), &source)?;
    let out_dir = resolve_output_dir(&source, opts.output_dir.as_deref())?;
    std::fs::create_dir_all(&out_dir)?;
    let out_path = unique_output_path(&source, &out_dir, "chain", &output_format);
    let filter_chain = build_effect_chain(&opts.effects, target_sample_rate);
    let source_name = display_name(&source);

    emit_progress(app, 0.0, "preparing", Some(source_name.clone()), None, None);

    let mut cmd = Command::new(&ffmpeg);
    cmd.arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(&source)
        .arg("-map")
        .arg("0:a:0")
        .arg("-vn")
        .arg("-af")
        .arg(&filter_chain);
    append_codec_args(&mut cmd, &output_format);
    cmd.arg("-progress")
        .arg("pipe:1")
        .arg("-nostats")
        .arg(&out_path);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    apply_no_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| LoadlinkError::SpawnFailed(format!("ffmpeg audio chain: {e}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| LoadlinkError::Other("ffmpeg stdout indisponible".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| LoadlinkError::Other("ffmpeg stderr indisponible".to_string()))?;

    let app_for_progress = app.clone();
    let source_for_progress = source_name.clone();
    let duration = probe.duration_seconds.unwrap_or(0.0);
    let out_path_string = out_path.to_string_lossy().to_string();

    let progress_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let time_re = Regex::new(r"out_time_(?:ms|us)=(\d+)").unwrap();
        while let Ok(Some(line)) = reader.next_line().await {
            if let Some(captures) = time_re.captures(&line) {
                let micros = captures
                    .get(1)
                    .and_then(|m| m.as_str().parse::<f64>().ok())
                    .unwrap_or(0.0);
                let processed = micros / 1_000_000.0;
                let percent = if duration > 0.0 {
                    ((processed / duration) * 100.0).min(99.0) as f32
                } else {
                    50.0
                };
                emit_progress(
                    &app_for_progress,
                    percent,
                    "processing",
                    Some(source_for_progress.clone()),
                    None,
                    Some(out_path_string.clone()),
                );
            }
        }
    });

    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut collected = String::new();
        while let Ok(Some(line)) = reader.next_line().await {
            collected.push_str(&line);
            collected.push('\n');
        }
        collected
    });

    let status = child
        .wait()
        .await
        .map_err(|e| LoadlinkError::Other(format!("ffmpeg wait: {e}")))?;
    let _ = progress_task.await;
    let stderr_collected = stderr_task.await.unwrap_or_default();

    if !status.success() {
        let _ = std::fs::remove_file(&out_path);
        let err = ffmpeg_error(&stderr_collected);
        emit_progress(app, 0.0, "failed", Some(source_name), None, None);
        return Ok(AudioProcessResult {
            success: false,
            output_path: String::new(),
            preset: "chain".to_string(),
            output_info: None,
            error: Some(err),
        });
    }

    emit_progress(
        app,
        100.0,
        "completed",
        Some(source_name),
        None,
        Some(out_path.to_string_lossy().to_string()),
    );
    cleanup_excess_chain_outputs(&source, &out_dir, &out_path, 5);

    let output_info = std::fs::metadata(&out_path)
        .ok()
        .map(|m| format!("Fichier audio: {:.1} Mo", m.len() as f64 / 1_048_576.0));

    Ok(AudioProcessResult {
        success: true,
        output_path: out_path.to_string_lossy().to_string(),
        preset: "chain".to_string(),
        output_info,
        error: None,
    })
}

#[derive(Debug, Clone, Default)]
struct InputProbe {
    duration_seconds: Option<f64>,
    sample_rate: Option<u32>,
}

async fn probe_input(ffmpeg: &Path, source: &Path) -> Result<InputProbe> {
    let mut cmd = Command::new(ffmpeg);
    cmd.arg("-hide_banner").arg("-i").arg(source);
    cmd.stdout(Stdio::null()).stderr(Stdio::piped());
    apply_no_window(&mut cmd);

    let output = cmd
        .output()
        .await
        .map_err(|e| LoadlinkError::SpawnFailed(format!("ffmpeg probe: {e}")))?;
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let analysis = parse_analysis(&stderr);
    if analysis.sample_rate.is_none() {
        return Err(LoadlinkError::InvalidArgument(
            "Aucune piste audio detectee dans ce fichier".to_string(),
        ));
    }

    Ok(InputProbe {
        duration_seconds: analysis.duration_seconds,
        sample_rate: analysis.sample_rate,
    })
}

fn parse_analysis(stderr: &str) -> AudioAnalysis {
    let duration_seconds = parse_duration(stderr);
    let (sample_rate, channels) = parse_stream_audio(stderr);
    let peak_dbfs = parse_peak_dbfs(stderr);
    let loudness_lufs = parse_loudness(stderr);
    let clipped_samples = parse_clipped_samples(stderr);
    let has_clipping = clipped_samples.unwrap_or(0) > 0 || peak_dbfs.is_some_and(|p| p >= -0.1);

    AudioAnalysis {
        duration_seconds,
        sample_rate,
        channels,
        loudness_lufs,
        peak_dbfs,
        has_clipping,
    }
}

fn parse_duration(stderr: &str) -> Option<f64> {
    let re = Regex::new(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)").ok()?;
    let captures = re.captures(stderr)?;
    let hours = captures.get(1)?.as_str().parse::<f64>().ok()?;
    let minutes = captures.get(2)?.as_str().parse::<f64>().ok()?;
    let seconds = captures.get(3)?.as_str().parse::<f64>().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn parse_stream_audio(stderr: &str) -> (Option<u32>, Option<u32>) {
    let re = match Regex::new(r"Audio:[^\n\r]*?,\s*(\d+)\s*Hz,\s*([^,\n\r]+)") {
        Ok(re) => re,
        Err(_) => return (None, None),
    };
    if let Some(captures) = re.captures(stderr) {
        let sample_rate = captures.get(1).and_then(|m| m.as_str().parse::<u32>().ok());
        let channels = captures.get(2).and_then(|m| parse_channels(m.as_str()));
        return (sample_rate, channels);
    }
    (None, None)
}

fn parse_channels(raw: &str) -> Option<u32> {
    let lower = raw.trim().to_lowercase();
    match lower.as_str() {
        "mono" => Some(1),
        "stereo" => Some(2),
        "2.1" => Some(3),
        "4.0" => Some(4),
        "5.0" => Some(5),
        "5.1" => Some(6),
        "7.1" => Some(8),
        _ => lower
            .split_whitespace()
            .next()
            .and_then(|n| n.parse::<u32>().ok()),
    }
}

fn parse_peak_dbfs(stderr: &str) -> Option<f32> {
    let re = Regex::new(r"Peak level dB:\s*(-?\d+(?:\.\d+)?)").ok()?;
    re.captures_iter(stderr)
        .filter_map(|c| c.get(1).and_then(|m| m.as_str().parse::<f32>().ok()))
        .reduce(f32::max)
        .or_else(|| {
            let true_peak = Regex::new(r"Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS").ok()?;
            true_peak
                .captures_iter(stderr)
                .filter_map(|c| c.get(1).and_then(|m| m.as_str().parse::<f32>().ok()))
                .reduce(f32::max)
        })
}

fn parse_loudness(stderr: &str) -> Option<f32> {
    let re = Regex::new(r"I:\s*(-?\d+(?:\.\d+)?)\s*LUFS").ok()?;
    re.captures_iter(stderr)
        .filter_map(|c| c.get(1).and_then(|m| m.as_str().parse::<f32>().ok()))
        .last()
}

fn parse_clipped_samples(stderr: &str) -> Option<u64> {
    let re = Regex::new(r"Number of clipped samples:\s*(\d+)").ok()?;
    let mut found = false;
    let total = re
        .captures_iter(stderr)
        .filter_map(|c| c.get(1).and_then(|m| m.as_str().parse::<u64>().ok()))
        .inspect(|_| found = true)
        .sum::<u64>();
    found.then_some(total)
}

fn ensure_source_exists(source: &Path) -> Result<()> {
    if !source.exists() {
        return Err(LoadlinkError::InvalidArgument(format!(
            "Source introuvable: {}",
            source.display()
        )));
    }
    if !source.is_file() {
        return Err(LoadlinkError::InvalidArgument(
            "La source audio doit etre un fichier".to_string(),
        ));
    }
    Ok(())
}

fn normalize_output_format(format: Option<&str>, source: &Path) -> Result<String> {
    let raw = format
        .filter(|f| !f.trim().is_empty())
        .map(|f| f.trim().trim_start_matches('.').to_lowercase())
        .or_else(|| {
            source
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
        })
        .unwrap_or_else(|| "wav".to_string());

    let cleaned: String = raw.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let normalized = match cleaned.as_str() {
        "jpeg" => "jpg".to_string(),
        "aif" => "aiff".to_string(),
        other => other.to_string(),
    };

    let allowed = [
        "wav", "flac", "aiff", "alac", "mp3", "aac", "m4a", "ogg", "opus", "wma",
    ];
    if allowed.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(LoadlinkError::InvalidArgument(format!(
            "Format audio non supporte: {raw}"
        )))
    }
}

fn resolve_output_dir(source: &Path, output_dir: Option<&str>) -> Result<PathBuf> {
    if let Some(dir) = output_dir.filter(|d| !d.trim().is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    let parent = source.parent().unwrap_or_else(|| Path::new("."));
    Ok(parent.join(AUDIO_OUTPUT_DIR_NAME))
}

fn unique_output_path(source: &Path, out_dir: &Path, preset_slug: &str, ext: &str) -> PathBuf {
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio");
    let base = format!("{stem}_{preset_slug}");
    let mut candidate = out_dir.join(format!("{base}.{ext}"));
    let mut idx = 1u32;
    while candidate.exists() {
        candidate = out_dir.join(format!("{base}-{idx}.{ext}"));
        idx += 1;
    }
    candidate
}

fn cleanup_excess_chain_outputs(source: &Path, out_dir: &Path, current_output: &Path, keep: usize) {
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio");
    let base = format!("{stem}_chain");
    let entries = match std::fs::read_dir(out_dir) {
        Ok(entries) => entries,
        Err(err) => {
            eprintln!(
                "[audio-master] temp cleanup skipped for {}: {err}",
                out_dir.display()
            );
            return;
        }
    };

    let mut candidates = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| {
            path.file_stem()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name == base || name.strip_prefix(&format!("{base}-")).is_some()
                })
        })
        .filter_map(|path| {
            let modified = std::fs::metadata(&path)
                .and_then(|metadata| metadata.modified())
                .ok()?;
            Some((path, modified))
        })
        .collect::<Vec<_>>();

    candidates.sort_by_key(|(_, modified)| Reverse(*modified));

    for (path, _) in candidates.into_iter().skip(keep) {
        if same_path(&path, current_output) {
            continue;
        }
        match std::fs::remove_file(&path) {
            Ok(_) => eprintln!(
                "[audio-master] deleted old chain render: {}",
                path.display()
            ),
            Err(err) => eprintln!(
                "[audio-master] failed to delete old chain render {}: {err}",
                path.display()
            ),
        }
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    let normalize = |path: &Path| path.to_string_lossy().replace('/', "\\").to_lowercase();
    normalize(a) == normalize(b)
}

fn append_codec_args(cmd: &mut Command, format: &str) {
    match format {
        "mp3" => {
            cmd.arg("-c:a").arg("libmp3lame").arg("-b:a").arg("320k");
        }
        "m4a" | "aac" => {
            cmd.arg("-c:a").arg("aac").arg("-b:a").arg("256k");
        }
        "flac" => {
            cmd.arg("-c:a").arg("flac");
        }
        "ogg" => {
            cmd.arg("-c:a").arg("libvorbis").arg("-q:a").arg("5");
        }
        "opus" => {
            cmd.arg("-c:a").arg("libopus").arg("-b:a").arg("160k");
        }
        "aiff" => {
            cmd.arg("-c:a").arg("pcm_s16be");
        }
        "alac" => {
            cmd.arg("-c:a").arg("alac");
        }
        "wma" => {
            cmd.arg("-c:a").arg("wmav2").arg("-b:a").arg("192k");
        }
        _ => {
            cmd.arg("-c:a").arg("pcm_s16le");
        }
    }
}

fn build_effect_chain(effects: &[AudioEffect], target_sample_rate: u32) -> String {
    let mut filters = Vec::new();

    for effect in effects {
        match effect {
            AudioEffect::Eq { enabled, bands } if *enabled => {
                for band in bands {
                    if let Some(filter) = eq_band_filter(band) {
                        filters.push(filter);
                    }
                }
            }
            AudioEffect::Compressor {
                enabled,
                threshold,
                ratio,
                attack,
                release,
                makeup,
            } if *enabled => {
                filters.push(format!(
                    "acompressor=threshold={}dB:ratio={}:attack={}:release={}:makeup={}",
                    clamp(*threshold, -60.0, 0.0),
                    clamp(*ratio, 1.0, 20.0),
                    clamp(*attack, 1.0, 100.0),
                    clamp(*release, 10.0, 500.0),
                    clamp(*makeup, 0.0, 24.0)
                ));
            }
            AudioEffect::DeEsser { enabled, intensity } if *enabled => {
                let i = clamp(intensity.unwrap_or(0.35), 0.0, 1.0);
                filters.push(format!("deesser=i={i}:m=0.5:f=0.55:s=o"));
            }
            AudioEffect::Denoise { enabled, amount } if *enabled => {
                let nr = clamp(amount.unwrap_or(12.0), 1.0, 30.0);
                filters.push(format!("afftdn=nr={nr}"));
            }
            AudioEffect::Silence {
                enabled,
                threshold,
                duration,
            } if *enabled => {
                let threshold = clamp(threshold.unwrap_or(-35.0), -80.0, -10.0);
                let duration = clamp(duration.unwrap_or(0.4), 0.05, 3.0);
                filters.push(format!(
                    "silenceremove=start_periods=1:start_duration={duration}:start_threshold={threshold}dB:stop_periods=-1:stop_duration={duration}:stop_threshold={threshold}dB"
                ));
            }
            AudioEffect::Loudnorm {
                enabled,
                target_lufs,
            } if *enabled => {
                filters.push(format!(
                    "loudnorm=I={}:TP=-1.5:LRA=11",
                    clamp(*target_lufs, -30.0, -8.0)
                ));
            }
            AudioEffect::Limiter { enabled } if *enabled => {
                // Final limiter is always appended below to keep a single true output guard.
            }
            AudioEffect::Reverb { enabled: _ } => {
                // Reserved for a later phase.
            }
            _ => {}
        }
    }

    filters.push(format!("aresample={target_sample_rate}"));
    filters.push("alimiter=limit=0.95".to_string());
    filters.join(",")
}

fn eq_band_filter(band: &EqBand) -> Option<String> {
    let freq = clamp(band.freq, 20.0, 20_000.0);
    let q = clamp(band.q, 0.1, 18.0);
    let gain = clamp(band.gain, -24.0, 24.0);
    match band.kind.as_str() {
        "highpass" => Some(format!("highpass=f={freq}")),
        "lowpass" => Some(format!("lowpass=f={freq}")),
        "lowshelf" | "highshelf" | "peaking" => {
            Some(format!("equalizer=f={freq}:t=q:w={q}:g={gain}"))
        }
        _ => None,
    }
}

fn clamp(value: f32, min: f32, max: f32) -> f32 {
    value.max(min).min(max)
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn ffmpeg_error(stderr: &str) -> String {
    stderr
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with("size="))
        .unwrap_or("ffmpeg audio a echoue")
        .to_string()
}

fn emit_progress(
    app: &AppHandle,
    percent: f32,
    stage: &str,
    current_file: Option<String>,
    preset: Option<AudioPreset>,
    output_path: Option<String>,
) {
    let _ = app.emit(
        "audio-progress",
        AudioProgress {
            percent,
            stage: stage.to_string(),
            current_file,
            preset: preset.map(|p| p.key().to_string()),
            output_path,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn preset_chain_resamples_before_final_limiter() {
        let chain = AudioPreset::PodcastInterview.filter_chain(48_000);
        let loudnorm = chain.find("loudnorm=").unwrap();
        let resample = chain.find("aresample=48000").unwrap();
        let limiter = chain.find("alimiter=limit=0.95").unwrap();
        assert!(loudnorm < resample);
        assert!(resample < limiter);
    }

    #[test]
    fn output_format_preserves_source_extension_when_none() {
        let source = PathBuf::from("memo vocal.m4a");
        let format = normalize_output_format(None, &source).unwrap();
        assert_eq!(format, "m4a");
    }

    #[test]
    fn output_path_uses_preset_slug_and_collision_suffix() {
        let root = std::env::temp_dir().join(format!("loadlink-audio-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("test.wav");
        fs::write(&source, b"source").unwrap();
        let first = root.join("test_clear-voice.wav");
        fs::write(&first, b"existing").unwrap();

        let out = unique_output_path(&source, &root, "clear-voice", "wav");
        assert_eq!(
            out.file_name().unwrap().to_string_lossy(),
            "test_clear-voice-1.wav"
        );

        let _ = fs::remove_dir_all(&root);
    }
}
