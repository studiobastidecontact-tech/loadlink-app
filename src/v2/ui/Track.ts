import { createSelectionStore } from '../state/selectionStore';
import { ProjectStore, Track as TrackModel } from '../types/project';
import { TrackCanvas } from './TrackCanvas';
import { TrackHeader } from './TrackHeader';
import { el } from './dom';

type SelectionStore = ReturnType<typeof createSelectionStore>;

export function Track(store: ProjectStore, selection: SelectionStore, track: TrackModel): HTMLElement {
  const row = el('div', 'v2-track-row');
  row.style.height = `${track.height}px`;
  row.append(TrackHeader(store, selection, track), TrackCanvas(store, selection, track));
  return row;
}
