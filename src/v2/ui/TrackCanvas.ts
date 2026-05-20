import { createSelectionStore } from '../state/selectionStore';
import { ProjectStore, Track } from '../types/project';
import { ClipView } from './Clip';
import { el } from './dom';

type SelectionStore = ReturnType<typeof createSelectionStore>;

export function TrackCanvas(store: ProjectStore, selection: SelectionStore, track: Track): HTMLElement {
  const root = el('div', 'v2-track-canvas');
  root.style.height = `${track.height}px`;
  root.addEventListener('click', () => selection.selectTrack(track.id));
  root.addEventListener('dragover', (event) => {
    event.preventDefault();
    root.classList.add('drag-over');
  });
  root.addEventListener('dragleave', () => root.classList.remove('drag-over'));
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    root.classList.remove('drag-over');
    const path = event.dataTransfer?.getData('text/plain');
    if (!path) return;
    const rect = root.getBoundingClientRect();
    store.addClip(track.id, { filePath: path, inPoint: 0, outPoint: 10 }, Math.max(0, (event.clientX - rect.left) / store.getProject().zoom));
  });
  track.clips.forEach((clip) => root.append(ClipView(store, selection, clip, track.id, track)));
  return root;
}
