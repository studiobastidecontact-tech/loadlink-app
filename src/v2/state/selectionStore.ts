import { ClipId, TrackId } from '../types/project';

export interface SelectionState {
  selectedTrackId: TrackId | null;
  selectedClipId: ClipId | null;
  tool: 'select' | 'split' | 'trim' | 'fade';
}

type Listener = (state: SelectionState) => void;

export function createSelectionStore() {
  let state: SelectionState = {
    selectedTrackId: null,
    selectedClipId: null,
    tool: 'select',
  };
  const listeners = new Set<Listener>();

  const emit = (): void => listeners.forEach((listener) => listener({ ...state }));

  return {
    getState: (): SelectionState => ({ ...state }),
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      listener({ ...state });
      return () => listeners.delete(listener);
    },
    selectTrack(id: TrackId | null): void {
      state = { ...state, selectedTrackId: id, selectedClipId: null };
      emit();
    },
    selectClip(id: ClipId | null, trackId: TrackId | null): void {
      state = { ...state, selectedClipId: id, selectedTrackId: trackId };
      emit();
    },
    setTool(tool: SelectionState['tool']): void {
      state = { ...state, tool };
      emit();
    },
  };
}
