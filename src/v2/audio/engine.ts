import { AudioDecoder } from './decoder';
import { Project, Track } from '../types/project';
import { ScheduledClipNode } from '../types/audio';

function dbToGain(db: number): number {
  if (db <= -90) return 0;
  return 10 ** (db / 20);
}

export class AudioEngine {
  readonly context: AudioContext;
  readonly decoder: AudioDecoder;
  private readonly master: GainNode;
  private scheduled: ScheduledClipNode[] = [];

  constructor() {
    this.context = new AudioContext({ sampleRate: 48000 });
    this.decoder = new AudioDecoder(this.context);
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
  }

  async resume(): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
  }

  stop(): void {
    this.scheduled.forEach((node) => {
      try {
        node.source.stop();
      } catch {
        // Already stopped.
      }
      node.source.disconnect();
      node.gain.disconnect();
      node.pan.disconnect();
    });
    this.scheduled = [];
  }

  async preloadProject(project: Project): Promise<void> {
    const paths = project.tracks.flatMap((track) => track.clips.map((clip) => clip.source.filePath));
    await Promise.all([...new Set(paths)].map((path) => this.decoder.decodeFile(path)));
  }

  async scheduleProject(project: Project, startTime: number): Promise<void> {
    this.stop();
    await this.resume();
    const hasSolo = project.tracks.some((track) => track.solo);
    const tracks = project.tracks.filter((track) => this.shouldPlayTrack(track, hasSolo));
    const contextStart = this.context.currentTime + 0.04;

    await Promise.all(tracks.map((track) => this.scheduleTrack(track, startTime, contextStart)));
  }

  private shouldPlayTrack(track: Track, hasSolo: boolean): boolean {
    if (track.type !== 'audio') return false;
    if (track.muted) return false;
    if (hasSolo && !track.solo) return false;
    return true;
  }

  private async scheduleTrack(track: Track, startTime: number, contextStart: number): Promise<void> {
    for (const clip of track.clips) {
      const clipStart = clip.timelinePosition;
      const clipEnd = clip.timelinePosition + clip.duration;
      if (clipEnd <= startTime) continue;

      const decoded = await this.decoder.decodeFile(clip.source.filePath);
      const sourceOffset = Math.max(0, startTime - clipStart);
      const when = contextStart + Math.max(0, clipStart - startTime);
      const duration = Math.max(0.01, clip.duration - sourceOffset);
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      const pan = this.context.createStereoPanner();
      source.buffer = decoded.buffer;

      const baseGain = dbToGain(track.gain + clip.gain);
      gain.gain.setValueAtTime(baseGain, when);
      if (clip.fadeIn > 0 && sourceOffset < clip.fadeIn) {
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(baseGain, when + Math.min(clip.fadeIn - sourceOffset, duration));
      }
      if (clip.fadeOut > 0) {
        const fadeStart = when + Math.max(0, duration - clip.fadeOut);
        gain.gain.setValueAtTime(baseGain, fadeStart);
        gain.gain.linearRampToValueAtTime(0, when + duration);
      }
      pan.pan.setValueAtTime(track.pan, when);

      source.connect(gain).connect(pan).connect(this.master);
      source.start(when, clip.source.inPoint + sourceOffset, duration);
      this.scheduled.push({ source, gain, pan, stopAt: when + duration });
    }
  }
}
