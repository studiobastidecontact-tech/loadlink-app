import { ProjectStore } from '../types/project';
import { el } from './dom';

export function VideoPreview(store: ProjectStore, getPlayhead: () => number): HTMLElement {
  const root = el('section', 'v2-video-preview');
  const video = document.createElement('video');
  video.controls = false;
  video.muted = true;
  video.playsInline = true;
  const empty = el('div', 'v2-video-empty', 'Dépose une vidéo pour la prévisualisation');
  root.append(video, empty);

  store.subscribe((project) => {
    if (!project.videoSource) {
      video.removeAttribute('src');
      video.classList.add('hidden');
      empty.classList.remove('hidden');
      return;
    }
    const src = window.__TAURI__?.core?.convertFileSrc(project.videoSource.filePath) ?? project.videoSource.filePath;
    if (video.src !== src) video.src = src;
    video.classList.remove('hidden');
    empty.classList.add('hidden');
    if (Math.abs(video.currentTime - getPlayhead()) > 0.2) video.currentTime = getPlayhead();
  });

  return root;
}
