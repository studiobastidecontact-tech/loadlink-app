import { createSelectionStore } from '../state/selectionStore';
import { ProjectStore } from '../types/project';
import { el, formatTime } from './dom';

type SelectionStore = ReturnType<typeof createSelectionStore>;

export function Inspector(store: ProjectStore, selection: SelectionStore): HTMLElement {
  const root = el('aside', 'v2-inspector');
  const render = (): void => {
    const state = selection.getState();
    const project = store.getProject();
    const track = project.tracks.find((candidate) => candidate.id === state.selectedTrackId);
    const clip = project.tracks.flatMap((item) => item.clips).find((candidate) => candidate.id === state.selectedClipId);
    root.innerHTML = '<h3>Inspecteur</h3>';
    if (clip) {
      root.append(
        line('Clip', clip.name),
        line('Position', formatTime(clip.timelinePosition)),
        line('Durée', formatTime(clip.duration)),
        line('Fade in', `${clip.fadeIn.toFixed(2)}s`),
        line('Fade out', `${clip.fadeOut.toFixed(2)}s`),
        line('Gain', `${clip.gain} dB`),
      );
      return;
    }
    if (track) {
      root.append(
        line('Piste', track.name),
        line('Type', track.type),
        line('Gain', `${track.gain} dB`),
        line('Pan', track.pan.toFixed(2)),
        line('Clips', String(track.clips.length)),
      );
      return;
    }
    root.append(el('p', 'v2-muted-text', 'Sélectionne une piste ou un clip.'));
  };
  const unsubA = store.subscribe(render);
  const unsubB = selection.subscribe(render);
  root.addEventListener('DOMNodeRemoved', () => {
    unsubA();
    unsubB();
  }, { once: true });
  return root;
}

function line(label: string, value: string): HTMLElement {
  const row = el('div', 'v2-inspector-line');
  row.append(el('span', undefined, label), el('strong', undefined, value));
  return row;
}
