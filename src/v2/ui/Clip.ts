import { createSelectionStore } from '../state/selectionStore';
import { Clip, ProjectStore, TrackId } from '../types/project';
import { basename, el } from './dom';

type SelectionStore = ReturnType<typeof createSelectionStore>;

interface DragState {
  mode: 'move' | 'trim-left' | 'trim-right' | 'fade-in' | 'fade-out';
  startX: number;
  startPosition: number;
  startDuration: number;
  startFadeIn: number;
  startFadeOut: number;
}

export function ClipView(
  store: ProjectStore,
  selection: SelectionStore,
  clip: Clip,
  trackId: TrackId,
): HTMLElement {
  const project = store.getProject();
  const root = el('div', 'v2-clip');
  root.dataset.clipId = clip.id;
  root.style.left = `${clip.timelinePosition * project.zoom}px`;
  root.style.width = `${Math.max(16, clip.duration * project.zoom)}px`;
  root.title = `${clip.name} · ${basename(clip.source.filePath)}`;

  const label = el('span', 'v2-clip-label', clip.name);
  const left = el('span', 'v2-clip-handle left');
  const right = el('span', 'v2-clip-handle right');
  const fadeIn = el('span', 'v2-fade-handle fade-in');
  const fadeOut = el('span', 'v2-fade-handle fade-out');
  fadeIn.style.width = `${Math.min(50, clip.fadeIn * project.zoom)}px`;
  fadeOut.style.width = `${Math.min(50, clip.fadeOut * project.zoom)}px`;
  root.append(label, left, right, fadeIn, fadeOut);

  selection.subscribe((state) => {
    root.classList.toggle('selected', state.selectedClipId === clip.id);
  });

  root.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    root.setPointerCapture(event.pointerId);
    selection.selectClip(clip.id, trackId);
    const target = event.target as HTMLElement;
    const mode: DragState['mode'] = target.classList.contains('left')
      ? 'trim-left'
      : target.classList.contains('right')
        ? 'trim-right'
        : target.classList.contains('fade-in')
          ? 'fade-in'
          : target.classList.contains('fade-out')
            ? 'fade-out'
            : selection.getState().tool === 'split'
              ? 'move'
              : 'move';
    const drag: DragState = {
      mode,
      startX: event.clientX,
      startPosition: clip.timelinePosition,
      startDuration: clip.duration,
      startFadeIn: clip.fadeIn,
      startFadeOut: clip.fadeOut,
    };
    const move = (moveEvent: PointerEvent): void => {
      const deltaSeconds = (moveEvent.clientX - drag.startX) / store.getProject().zoom;
      if (drag.mode === 'move') {
        store.moveClip(clip.id, Math.max(0, drag.startPosition + deltaSeconds));
      }
      if (drag.mode === 'trim-left') store.trimClip(clip.id, 'left', deltaSeconds);
      if (drag.mode === 'trim-right') store.trimClip(clip.id, 'right', deltaSeconds);
      if (drag.mode === 'fade-in') store.updateClip(clip.id, { fadeIn: Math.max(0, Math.min(drag.startDuration, drag.startFadeIn + deltaSeconds)) });
      if (drag.mode === 'fade-out') store.updateClip(clip.id, { fadeOut: Math.max(0, Math.min(drag.startDuration, drag.startFadeOut - deltaSeconds)) });
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
    if (playhead > clip.timelinePosition && playhead < clip.timelinePosition + clip.duration) {
      store.splitClip(clip.id, playhead);
    }
  });

  return root;
}
