import { AudioEngine } from '../audio/engine';
import { PlaybackController } from '../audio/playback';
import { createProjectStore } from '../state/projectStore';
import { createSelectionStore } from '../state/selectionStore';
import { ClipSource, DEFAULTS, Project, TrackId } from '../types/project';
import { Header } from './Header';
import { Inspector } from './Inspector';
import { TimelineRuler } from './TimelineRuler';
import { Toolbar } from './Toolbar';
import { TrackList } from './TrackList';
import { Transport } from './Transport';
import { VideoPreview } from './VideoPreview';
import { basename, el, isAudioPath, isVideoPath } from './dom';
import { loadProjectFile, saveProjectFile } from '../persistence/projectFile';

export class AudioV2App {
  private readonly store = createProjectStore('Projet Timeline V2');
  private readonly selection = createSelectionStore();
  private readonly engine = new AudioEngine();
  private readonly playback = new PlaybackController(this.store, this.engine);
  private playheadEl: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {}

  mount(): void {
    this.ensureInitialTracks();
    this.root.className = 'v2-app';
    this.root.innerHTML = '';

    const main = el('main', 'v2-main');
    const center = el('section', 'v2-center');
    const timelineScroll = el('div', 'v2-timeline-scroll');
    const timelineInner = el('div', 'v2-timeline-inner');
    this.playheadEl = el('div', 'v2-playhead');
    timelineInner.append(
      TimelineRuler(this.store, (time) => void this.playback.seek(time)),
      TrackList(this.store, this.selection),
      this.playheadEl,
    );
    timelineScroll.append(timelineInner);
    center.append(
      VideoPreview(this.store, () => this.playback.getPlayhead()),
      Toolbar(this.store, this.selection, () => void this.importAudio()),
      timelineScroll,
    );
    main.append(center, Inspector(this.store, this.selection));

    this.root.append(
      Header(this.store, () => void this.saveProject(), () => void this.loadProject()),
      main,
      Transport(this.store, this.playback),
    );

    this.bindDrop(timelineScroll);
    this.bindKeyboard();
    this.store.subscribe((project) => this.renderPlayhead(project));
    this.playback.subscribe((time) => this.movePlayhead(time));
  }

  private ensureInitialTracks(): void {
    const project = this.store.getProject();
    if (project.tracks.length > 0) return;
    this.store.addTrack('video', 'Vidéo référence');
    this.store.addTrack('audio', 'Dialogue');
    this.store.addTrack('audio', 'Ambiances');
    this.store.addTrack('audio', 'Musique');
  }

  private async importAudio(): Promise<void> {
    const selected = await this.openFile(['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aiff', 'aif', 'wma']);
    if (!selected) return;
    await this.addMediaPath(selected);
  }

  private async addMediaPath(path: string, timelinePosition = this.store.getPlayhead()): Promise<void> {
    if (isVideoPath(path)) {
      await this.addVideo(path);
      return;
    }
    if (!isAudioPath(path)) return;
    const targetTrack = this.firstAudioTrack();
    const decoded = await this.engine.decoder.decodeFile(path);
    const source: ClipSource = { filePath: path, inPoint: 0, outPoint: decoded.duration };
    this.store.addClip(targetTrack, source, timelinePosition, basename(path).replace(/\.[^.]+$/, ''));
  }

  private async addVideo(path: string): Promise<void> {
    const project = this.store.getProject();
    const videoTrack = project.tracks.find((track) => track.type === 'video')?.id ?? this.store.addTrack('video', 'Vidéo référence');
    const duration = await this.probeVideoDuration(path);
    const nextProject: Project = {
      ...project,
      videoSource: {
        filePath: path,
        duration,
        width: 1920,
        height: 1080,
        hasAudio: true,
      },
    };
    this.store.loadProject(nextProject);
    this.store.addClip(videoTrack, { filePath: path, inPoint: 0, outPoint: duration }, 0, basename(path));
  }

  private firstAudioTrack(): TrackId {
    const existing = this.store.getProject().tracks.find((track) => track.type === 'audio');
    return existing?.id ?? this.store.addTrack('audio', 'Piste audio');
  }

  private async openFile(extensions: string[]): Promise<string | null> {
    const open = window.__TAURI__?.dialog?.open;
    if (!open) return null;
    const selected = await open({ multiple: false, filters: [{ name: 'Media', extensions }] });
    if (!selected) return null;
    return Array.isArray(selected) ? selected[0] ?? null : selected;
  }

  private bindDrop(target: HTMLElement): void {
    target.addEventListener('dragover', (event) => {
      event.preventDefault();
      target.classList.add('drag-over');
    });
    target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
    target.addEventListener('drop', (event) => {
      event.preventDefault();
      target.classList.remove('drag-over');
      const textPath = event.dataTransfer?.getData('text/plain');
      if (textPath) {
        const rect = target.getBoundingClientRect();
        const position = Math.max(0, (event.clientX - rect.left - 240) / this.store.getProject().zoom);
        void this.addMediaPath(textPath, position);
      }
    });
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space') {
        event.preventDefault();
        void this.playback.toggle();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') this.store.undo();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') this.store.redo();
      if (event.key.toLowerCase() === 's' && this.selection.getState().selectedClipId) {
        const id = this.selection.getState().selectedClipId;
        if (id) this.store.splitClip(id, this.store.getPlayhead());
      }
    });
  }

  private renderPlayhead(project: Project): void {
    const timeline = this.root.querySelector<HTMLElement>('.v2-timeline-inner');
    if (timeline) timeline.style.width = `${project.duration * project.zoom + 260}px`;
    this.movePlayhead(project.playhead);
  }

  private movePlayhead(time: number): void {
    if (!this.playheadEl) return;
    this.playheadEl.style.transform = `translateX(${240 + time * this.store.getProject().zoom}px)`;
  }

  private async probeVideoDuration(path: string): Promise<number> {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = window.__TAURI__?.core?.convertFileSrc(path) ?? path;
    return new Promise((resolve) => {
      video.addEventListener('loadedmetadata', () => resolve(Number.isFinite(video.duration) ? video.duration : DEFAULTS.PROJECT.duration), { once: true });
      video.addEventListener('error', () => resolve(DEFAULTS.PROJECT.duration), { once: true });
    });
  }

  private async saveProject(): Promise<void> {
    await saveProjectFile(this.store.getProject());
  }

  private async loadProject(): Promise<void> {
    const project = await loadProjectFile();
    if (project) this.store.loadProject(project);
  }
}
