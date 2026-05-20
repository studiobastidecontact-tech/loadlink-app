import { AudioEngine } from '../audio/engine';
import { PlaybackController } from '../audio/playback';
import { loadProjectFile, saveProjectFile } from '../persistence/projectFile';
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

export class AudioV2App {
  private readonly store = createProjectStore('Pub TV - Marie & Lucas - Master final');
  private readonly selection = createSelectionStore();
  private readonly engine = new AudioEngine();
  private readonly playback = new PlaybackController(this.store, this.engine);
  private readonly embedded = this.isEmbedded();
  private playheadEl: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {}

  mount(): void {
    this.ensureInitialTracks();
    this.root.className = `v2-app v2-mockup${this.embedded ? ' embedded' : ''}`;
    this.root.innerHTML = '';

    const main = el('main', 'v2-main');
    const tracksArea = el('div', 'v2-tracks-area');
    const timelineInner = el('div', 'v2-timeline-inner');
    const rulerWrap = el('div', 'v2-ruler-wrap');
    this.playheadEl = el('div', 'v2-playhead');

    rulerWrap.append(el('div', 'v2-track-spacer'), TimelineRuler(this.store, (time) => void this.playback.seek(time)));
    timelineInner.append(rulerWrap, TrackList(this.store, this.selection), this.playheadEl);
    tracksArea.append(timelineInner);

    main.append(
      this.renderInfoBanner(),
      Header(this.store, () => void this.saveProject(), () => void this.loadProject()),
      VideoPreview(this.store, () => this.playback.getPlayhead()),
      Toolbar(
        this.store,
        this.selection,
        () => void this.importAudio(),
        () => void this.importVideo(),
        () => this.splitSelectedAtPlayhead(),
      ),
      tracksArea,
      Transport(this.store, this.playback),
    );

    if (this.embedded) {
      this.root.append(main, Inspector(this.store, this.selection));
    } else {
      this.root.append(this.renderSidebar(), main, Inspector(this.store, this.selection));
    }

    this.bindDrop(tracksArea);
    void this.bindNativeDrop();
    this.bindKeyboard();
    this.store.subscribe((project) => this.renderPlayhead(project));
    this.playback.subscribe((time) => this.movePlayhead(time));
  }

  private renderSidebar(): HTMLElement {
    const sidebar = el('aside', 'v2-sidebar');
    const logo = el('div', 'v2-logo');
    logo.append(el('div', 'v2-logo-icon', '↓'), el('span', undefined, 'LoadLink'));
    sidebar.append(logo, el('div', 'v2-sidebar-section', 'Modules'));

    [
      ['⌂', 'Accueil'],
      ['↓', 'Capturer'],
      ['🎤', 'Transcrire'],
      ['⧗', 'Compresser'],
      ['↻', 'Convertir'],
      ['♪', 'Audio V2'],
      ['▣', 'Vidéo'],
      ['◈', 'IA Studio'],
    ].forEach(([icon, label]) => {
      const item = el('button', `v2-sidebar-item${label === 'Audio V2' ? ' active' : ''}`);
      item.type = 'button';
      item.textContent = `${icon} ${label}`;
      sidebar.append(item);
    });

    return sidebar;
  }

  private isEmbedded(): boolean {
    const params = new URLSearchParams(window.location.search);
    if (params.get('embedded') === '1') return true;
    try {
      return window.parent !== window;
    } catch {
      return false;
    }
  }

  private renderInfoBanner(): HTMLElement {
    const banner = el('div', 'v2-info-banner');
    banner.innerHTML = '<span>🎯 <strong>Chantier 1 - Timeline multi-pistes</strong> · Drag clips · Trim edges · Click selection · Web Audio actif</span><span>Audio V2</span>';
    return banner;
  }

  private ensureInitialTracks(): void {
    const project = this.store.getProject();
    if (project.tracks.length > 0) return;
    this.store.addTrack('video', 'Vidéo source');
    this.store.addTrack('audio', 'Dialogue · Marie');
    this.store.addTrack('audio', 'Dialogue · Lucas');
    this.store.addTrack('audio', 'Ambiance studio');
    this.store.addTrack('audio', 'Musique');
    this.store.addTrack('audio', 'SFX / Foley');
  }

  private async importAudio(): Promise<void> {
    const selected = await this.openFile(['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aiff', 'aif', 'wma']);
    if (!selected) return;
    await this.addMediaPath(selected);
  }

  private async importVideo(): Promise<void> {
    const selected = await this.openFile(['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v']);
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
    const videoTrack = project.tracks.find((track) => track.type === 'video')?.id ?? this.store.addTrack('video', 'Vidéo source');
    const duration = await this.probeVideoDuration(path);
    const nextProject: Project = {
      ...project,
      videoSource: { filePath: path, duration, width: 1920, height: 1080, hasAudio: true },
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
      if (!textPath) return;
      const rect = target.getBoundingClientRect();
      const position = Math.max(0, (event.clientX - rect.left - 180) / this.store.getProject().zoom);
      void this.addMediaPath(textPath, position);
    });
  }

  private async bindNativeDrop(): Promise<void> {
    const webview = window.__TAURI__?.webview?.getCurrentWebview?.();
    if (!webview) return;
    await webview.onDragDropEvent((event) => {
      if (event.payload?.type !== 'drop') return;
      const path = event.payload.paths?.[0];
      if (path) void this.addMediaPath(path, this.store.getPlayhead());
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
      if (event.key.toLowerCase() === 's') this.splitSelectedAtPlayhead();
    });
  }

  private splitSelectedAtPlayhead(): void {
    const id = this.selection.getState().selectedClipId;
    if (id) this.store.splitClip(id, this.store.getPlayhead());
  }

  private renderPlayhead(project: Project): void {
    const timeline = this.root.querySelector<HTMLElement>('.v2-timeline-inner');
    if (timeline) timeline.style.width = `${project.duration * project.zoom + 180}px`;
    this.movePlayhead(project.playhead);
  }

  private movePlayhead(time: number): void {
    if (!this.playheadEl) return;
    this.playheadEl.style.transform = `translateX(${180 + time * this.store.getProject().zoom}px)`;
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
