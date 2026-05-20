import { ProjectStore } from '../types/project';
import { el, formatTime } from './dom';

export function VideoPreview(store: ProjectStore, getPlayhead: () => number): HTMLElement {
  const root = el('section', 'v2-video-zone');
  const video = document.createElement('video');
  video.controls = false;
  video.muted = true;
  video.playsInline = true;
  const empty = el('div', 'v2-video-placeholder', 'Aperçu vidéo');
  const timecode = el('div', 'v2-timecode-overlay', '00:00.00');
  const controls = el('div', 'v2-video-controls');
  controls.append(el('button', 'v2-vc-btn', '⛶'), el('button', 'v2-vc-btn', '-1f'), el('button', 'v2-vc-btn', '+1f'));
  root.append(video, empty, timecode, controls);

  const sync = (): void => {
    const playhead = getPlayhead();
    timecode.textContent = formatTime(playhead);
    if (!video.classList.contains('hidden') && Math.abs(video.currentTime - playhead) > 0.2) video.currentTime = playhead;
  };

  store.subscribe((project) => {
    if (!project.videoSource) {
      video.removeAttribute('src');
      video.classList.add('hidden');
      empty.classList.remove('hidden');
      sync();
      return;
    }
    const src = window.__TAURI__?.core?.convertFileSrc(project.videoSource.filePath) ?? project.videoSource.filePath;
    if (video.src !== src) video.src = src;
    video.classList.remove('hidden');
    empty.classList.add('hidden');
    sync();
  });

  return root;
}
