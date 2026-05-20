import { AudioEngine } from './engine';
import { ProjectStore } from '../types/project';

type Listener = (time: number, playing: boolean) => void;

export class PlaybackController {
  private playing = false;
  private playheadAtStart = 0;
  private contextStartedAt = 0;
  private raf = 0;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly store: ProjectStore,
    private readonly engine: AudioEngine,
  ) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.store.getPlayhead(), this.playing);
    return () => this.listeners.delete(listener);
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getPlayhead(): number {
    if (!this.playing) return this.store.getPlayhead();
    const elapsed = this.engine.context.currentTime - this.contextStartedAt;
    return Math.min(this.playheadAtStart + elapsed, this.store.getProject().duration);
  }

  async play(): Promise<void> {
    if (this.playing) return;
    const project = this.store.getProject();
    this.playheadAtStart = project.playhead;
    this.contextStartedAt = await this.engine.scheduleProject(project, project.playhead);
    this.playing = true;
    this.emit(project.playhead);
    this.tick();
  }

  pause(): void {
    if (!this.playing) return;
    const current = this.getPlayhead();
    this.engine.stop();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.store.setPlayhead(current);
    this.emit(current);
  }

  async toggle(): Promise<void> {
    if (this.playing) this.pause();
    else await this.play();
  }

  async seek(time: number): Promise<void> {
    const wasPlaying = this.playing;
    this.engine.stop();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.store.setPlayhead(time);
    this.emit(this.store.getPlayhead());
    if (wasPlaying) await this.play();
  }

  stop(): void {
    this.engine.stop();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.store.setPlayhead(0);
    this.emit(0);
  }

  private tick = (): void => {
    if (!this.playing) return;
    const time = this.getPlayhead();
    this.store.setPlayhead(time);
    this.emit(time);
    if (time >= this.store.getProject().duration) {
      this.stop();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private emit(time: number): void {
    this.listeners.forEach((listener) => listener(time, this.playing));
  }
}
