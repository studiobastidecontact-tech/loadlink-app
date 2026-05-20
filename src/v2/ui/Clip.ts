import { createSelectionStore } from '../state/selectionStore';
import { Clip, ProjectStore, Track, TrackId } from '../types/project';
import { basename, el } from './dom';

type SelectionStore = ReturnType<typeof createSelectionStore>;
type DragMode = 'move' | 'trim-left' | 'trim-right' | 'fade-in' | 'fade-out';

export function ClipView(
  store: ProjectStore,
  selection: SelectionStore,
  clip: Clip,
  trackId: TrackId,
  track: Track,
): HTMLElement {
  const project = store.getProject();
  const root = el('div', `v2-clip ${clipColorClass(track.color)}`);
  root.dataset.clipId = clip.id;
  root.style.left = `${clip.timelinePosition * project.zoom}px`;
  root.style.width = `${Math.max(18, clip.duration * project.zoom)}px`;
  root.title = `${clip.name} · ${basename(clip.source.filePath)}`;
  root.append(
    el('div', 'v2-clip-handle left'),
    el('span', 'v2-clip-label', clip.name),
    renderWave(track.color),
    renderFade('in', clip.fadeIn, clip.duration),
    renderFade('out', clip.fadeOut, clip.duration),
    el('div', 'v2-clip-handle right'),
  );

  selection.subscribe((state) => root.classList.toggle('selected', state.selectedClipId === clip.id));

  root.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    selection.selectClip(clip.id, trackId);
    const target = event.target as HTMLElement;
    if (selection.getState().tool === 'split' && !target.classList.contains('v2-clip-handle') && !target.classList.contains('v2-fade-handle')) {
      store.splitClip(clip.id, store.getPlayhead());
      return;
    }
    root.setPointerCapture(event.pointerId);
    const mode: DragMode = target.classList.contains('left')
      ? 'trim-left'
      : target.classList.contains('right')
        ? 'trim-right'
        : target.classList.contains('fade-in')
          ? 'fade-in'
          : target.classList.contains('fade-out')
            ? 'fade-out'
            : 'move';
    const start = {
      x: event.clientX,
      position: clip.timelinePosition,
      duration: clip.duration,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
    };
    const move = (moveEvent: PointerEvent): void => {
      const delta = (moveEvent.clientX - start.x) / store.getProject().zoom;
      if (mode === 'move') store.moveClip(clip.id, start.position + delta);
      if (mode === 'trim-left') store.trimClip(clip.id, 'left', delta);
      if (mode === 'trim-right') store.trimClip(clip.id, 'right', delta);
      if (mode === 'fade-in') store.updateClip(clip.id, { fadeIn: Math.max(0, Math.min(start.duration, start.fadeIn + delta)) });
      if (mode === 'fade-out') store.updateClip(clip.id, { fadeOut: Math.max(0, Math.min(start.duration, start.fadeOut - delta)) });
    };
    const up = (): void => {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
  });

  root.addEventListener('dblclick', () => {
    const playhead = store.getPlayhead();
    if (playhead > clip.timelinePosition && playhead < clip.timelinePosition + clip.duration) store.splitClip(clip.id, playhead);
  });

  return root;
}

function renderWave(color: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'v2-clip-wave');
  svg.setAttribute('viewBox', '0 0 200 40');
  svg.setAttribute('preserveAspectRatio', 'none');
  for (let i = 0; i < 34; i += 1) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const height = 5 + Math.abs(Math.sin(i * 1.7)) * 30;
    rect.setAttribute('x', String(i * 6));
    rect.setAttribute('y', String((40 - height) / 2));
    rect.setAttribute('width', '3');
    rect.setAttribute('height', height.toFixed(1));
    rect.setAttribute('rx', '1.5');
    rect.setAttribute('fill', color);
    rect.setAttribute('opacity', '0.72');
    svg.append(rect);
  }
  return svg;
}

function renderFade(kind: 'in' | 'out', value: number, duration: number): HTMLElement {
  const fade = el('div', `v2-clip-fade-${kind}`);
  fade.style.width = `${duration > 0 ? Math.min(40, (value / duration) * 100) : 0}%`;
  fade.append(el('span', `v2-fade-handle ${kind}`));
  return fade;
}

function clipColorClass(color: string): string {
  const colors = ['#2B6FE6', '#1D9E75', '#EF9F27', '#7F77DD', '#D85A30', '#D4537E', '#97C459'];
  const names = ['blue', 'teal', 'amber', 'purple', 'coral', 'pink', 'green'];
  const index = colors.findIndex((item) => item.toLowerCase() === color.toLowerCase());
  return `col-${index >= 0 ? names[index] : 'gray'}`;
}
