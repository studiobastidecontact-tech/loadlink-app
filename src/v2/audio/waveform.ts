export interface WaveformPeak {
  min: number;
  max: number;
}

export function generateWaveformPeaks(buffer: AudioBuffer, width: number): WaveformPeak[] {
  const channel = buffer.getChannelData(0);
  const bucketSize = Math.max(1, Math.floor(channel.length / Math.max(1, width)));
  const peaks: WaveformPeak[] = [];
  for (let i = 0; i < width; i += 1) {
    const start = i * bucketSize;
    const end = Math.min(channel.length, start + bucketSize);
    let min = 0;
    let max = 0;
    for (let sample = start; sample < end; sample += 1) {
      const value = channel[sample] ?? 0;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    peaks.push({ min, max });
  }
  return peaks;
}

export function renderWaveformCanvas(canvas: HTMLCanvasElement, peaks: WaveformPeak[], color: string): void {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 1;
  const height = canvas.clientHeight || 1;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const mid = height / 2;
  peaks.forEach((peak, index) => {
    const x = (index / Math.max(1, peaks.length - 1)) * width;
    ctx.beginPath();
    ctx.moveTo(x, mid + peak.min * mid);
    ctx.lineTo(x, mid + peak.max * mid);
    ctx.stroke();
  });
}
