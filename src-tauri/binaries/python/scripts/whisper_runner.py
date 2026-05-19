#!/usr/bin/env python3
"""
whisper_runner.py - LoadLink Whisper transcription wrapper

Spawned by the Rust backend (loadlink-transcriber crate) with CLI args.

Emits JSON event lines on stdout for the Rust process to consume:
  {"type":"progress","stage":"download_video","pct":0}
  {"type":"progress","stage":"extract_audio","pct":50}
  {"type":"progress","stage":"load_model","pct":100}
  {"type":"progress","stage":"transcribe","pct":75}
  {"type":"file_written","path":"C:/.../output.srt"}
  {"type":"result","success":true,"output_files":[...],"language_detected":"fr","duration_seconds":123.4}
  {"type":"result","success":false,"error":"..."}

Exits with code 0 on success, 1 on failure.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path


def emit(event):
    """Print a JSON event line to stdout (consumed by Rust)."""
    print(json.dumps(event, ensure_ascii=False), flush=True)


def is_youtube_url(s):
    return bool(re.match(r'^https?://(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)/', s))


def needs_audio_extraction(path):
    """True if it's a video file (heuristic by extension)."""
    return path.suffix.lower() in {".mp4", ".mov", ".mkv", ".avi", ".webm", ".flv", ".m4v", ".wmv", ".ts"}


def find_ffmpeg():
    """Locate the bundled ffmpeg.exe.
    
    whisper_runner.py lives at: <root>/binaries/python/scripts/whisper_runner.py
    ffmpeg.exe lives at:        <root>/binaries/ffmpeg.exe
    So we go up 2 dirs from the script.
    """
    candidate = Path(__file__).resolve().parent.parent.parent / "ffmpeg.exe"
    if not candidate.exists():
        raise RuntimeError(f"ffmpeg.exe introuvable a {candidate}")
    return candidate


def download_youtube(url, work_dir):
    """Use yt-dlp Python lib to download audio only."""
    emit({"type": "progress", "stage": "download_video", "pct": 0})
    try:
        import yt_dlp
    except ImportError:
        raise RuntimeError("yt-dlp non installe dans le Python embeddable")
    
    out_template = str(work_dir / "yt_audio.%(ext)s")
    
    def progress_hook(d):
        if d['status'] == 'downloading':
            try:
                total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
                downloaded = d.get('downloaded_bytes', 0)
                if total > 0:
                    pct = int((downloaded / total) * 100)
                    emit({"type": "progress", "stage": "download_video", "pct": min(pct, 99)})
            except Exception:
                pass
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': out_template,
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'progress_hooks': [progress_hook],
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'wav',
        }],
        'ffmpeg_location': str(find_ffmpeg().parent),
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
    
    # Find the produced file (extension may vary)
    for f in work_dir.glob("yt_audio.*"):
        emit({"type": "progress", "stage": "download_video", "pct": 100})
        return f
    raise RuntimeError("yt-dlp n'a produit aucun fichier audio")


def extract_audio(input_path, work_dir):
    """Use bundled ffmpeg.exe to extract audio from video."""
    emit({"type": "progress", "stage": "extract_audio", "pct": 0})
    ffmpeg = find_ffmpeg()
    out = work_dir / "extracted_audio.wav"
    proc = subprocess.run([
        str(ffmpeg), "-y", "-i", str(input_path),
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        str(out),
    ], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr[-500:]}")
    emit({"type": "progress", "stage": "extract_audio", "pct": 100})
    return out


def transcribe_audio(audio_path, model_name, language, translate):
    """Run faster-whisper. Returns (segments, info)."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise RuntimeError("faster-whisper non installe dans le Python embeddable")
    
    emit({"type": "progress", "stage": "load_model", "pct": 0})
    # CPU with int8 quantization is the most portable. CUDA detection later.
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    emit({"type": "progress", "stage": "load_model", "pct": 100})
    
    task = "translate" if translate else "transcribe"
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        task=task,
        beam_size=5,
        vad_filter=True,
    )
    
    # Materialize segments and emit progress
    segments = []
    total_duration = info.duration or 1.0
    emit({"type": "progress", "stage": "transcribe", "pct": 0})
    for seg in segments_iter:
        segments.append(seg)
        pct = int(min(99, (seg.end / total_duration) * 100))
        emit({"type": "progress", "stage": "transcribe", "pct": pct})
    emit({"type": "progress", "stage": "transcribe", "pct": 100})
    
    return segments, info


def format_srt_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def format_vtt_time(seconds):
    return format_srt_time(seconds).replace(",", ".")


def write_txt(segments, output_path):
    with open(output_path, "w", encoding="utf-8") as f:
        for seg in segments:
            f.write(seg.text.strip() + "\n")


def write_srt(segments, output_path):
    with open(output_path, "w", encoding="utf-8") as f:
        for i, seg in enumerate(segments, start=1):
            f.write(f"{i}\n")
            f.write(f"{format_srt_time(seg.start)} --> {format_srt_time(seg.end)}\n")
            f.write(seg.text.strip() + "\n\n")


def write_vtt(segments, output_path):
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for seg in segments:
            f.write(f"{format_vtt_time(seg.start)} --> {format_vtt_time(seg.end)}\n")
            f.write(seg.text.strip() + "\n\n")


def write_json(segments, info, output_path):
    data = {
        "language": info.language,
        "language_probability": float(info.language_probability),
        "duration": float(info.duration),
        "segments": [
            {
                "id": i,
                "start": float(seg.start),
                "end": float(seg.end),
                "text": seg.text,
            }
            for i, seg in enumerate(segments)
        ],
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def sanitize_filename(name):
    """Remove characters that are not valid in Windows filenames."""
    return re.sub(r'[<>:"/\\|?*]', '_', name)[:200]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="File path or YouTube URL")
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default=None, help="ISO 639-1 code or empty for auto-detect")
    parser.add_argument("--formats", default="txt,srt,vtt,json")
    parser.add_argument("--translate", action="store_true")
    args = parser.parse_args()
    
    # Normalize args
    language = args.language if args.language and args.language != "auto" else None
    formats = [f.strip().lower() for f in args.formats.split(",") if f.strip()]
    
    try:
        with tempfile.TemporaryDirectory() as tmp:
            work_dir = Path(tmp)
            
            # 1. Resolve input -> audio file
            if is_youtube_url(args.input):
                audio_path = download_youtube(args.input, work_dir)
                base_name = "transcription"
            else:
                input_path = Path(args.input)
                if not input_path.exists():
                    raise RuntimeError(f"Fichier introuvable : {input_path}")
                if needs_audio_extraction(input_path):
                    audio_path = extract_audio(input_path, work_dir)
                else:
                    audio_path = input_path
                base_name = sanitize_filename(input_path.stem)
            
            # 2. Determine output dir
            if args.output_dir:
                out_dir = Path(args.output_dir)
            elif is_youtube_url(args.input):
                out_dir = Path.home() / "Documents" / "LoadLink-Transcriptions"
            else:
                out_dir = Path(args.input).parent
            out_dir.mkdir(parents=True, exist_ok=True)
            
            # 3. Transcribe
            segments, info = transcribe_audio(audio_path, args.model, language, args.translate)
            
            # 4. Write requested formats
            output_files = []
            for fmt in formats:
                if fmt == "txt":
                    p = out_dir / f"{base_name}.txt"
                    write_txt(segments, p)
                elif fmt == "srt":
                    p = out_dir / f"{base_name}.srt"
                    write_srt(segments, p)
                elif fmt == "vtt":
                    p = out_dir / f"{base_name}.vtt"
                    write_vtt(segments, p)
                elif fmt == "json":
                    p = out_dir / f"{base_name}.json"
                    write_json(segments, info, p)
                else:
                    continue
                output_files.append(str(p))
                emit({"type": "file_written", "path": str(p)})
            
            # 5. Done
            emit({
                "type": "result",
                "success": True,
                "output_files": output_files,
                "language_detected": info.language,
                "duration_seconds": float(info.duration),
            })
            sys.exit(0)
    
    except Exception as e:
        # Emit a friendly error event AND log the traceback to stderr for debugging
        traceback.print_exc(file=sys.stderr)
        emit({
            "type": "result",
            "success": False,
            "output_files": [],
            "language_detected": None,
            "duration_seconds": None,
            "error": str(e),
        })
        sys.exit(1)


if __name__ == "__main__":
    main()
