import { createSelectionStore } from '../state/selectionStore';
import { ProjectStore } from '../types/project';
import { el } from './dom';
import { Track } from './Track';

type SelectionStore = ReturnType<typeof createSelectionStore>;

export function TrackList(store: ProjectStore, selection: SelectionStore): HTMLElement {
  const root = el('section', 'v2-track-list');
  store.subscribe((project) => {
    root.innerHTML = '';
    project.tracks.forEach((track) => root.append(Track(store, selection, track)));
  });
  return root;
}
