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
    root.innerHTML = '';
    const tabs = el('div', 'v2-ins-tabs');
    ['Clip', 'Piste', 'Master', 'Browser'].forEach((label, index) => tabs.append(el('button', `v2-ins-tab${index === 0 ? ' active' : ''}`, label)));
    root.append(tabs);

    if (clip) {
      root.append(
        section('Clip sélectionné', clip.name, [
          row('Début timeline', formatTime(clip.timelinePosition)),
          row('Durée', formatTime(clip.duration)),
          row('In source', formatTime(clip.source.inPoint)),
          row('Out source', formatTime(clip.source.outPoint)),
        ]),
        knobs([
          ['Gain', `${clip.gain.toFixed(1)} dB`],
          ['Pan', 'C'],
          ['Fade in', `${Math.round(clip.fadeIn * 1000)} ms`],
          ['Fade out', `${Math.round(clip.fadeOut * 1000)} ms`],
        ]),
      );
    } else if (track) {
      root.append(
        section('Piste sélectionnée', track.name, [
          row('Type', track.type),
          row('Gain', `${track.gain.toFixed(1)} dB`),
          row('Pan', track.pan.toFixed(2)),
          row('Clips', String(track.clips.length)),
        ]),
      );
    } else {
      root.append(section('Inspecteur', 'Rien sélectionné', [row('Astuce', 'Clique un clip ou une piste')]));
    }

    root.append(
      section('Chaîne effets', track?.name ?? 'Master', []),
      fxList(),
      section('Routing', 'Sortie master', [row('Destination', 'Master 1-2'), row('Monitoring', 'Web Audio API')]),
    );
  };
  store.subscribe(render);
  selection.subscribe(render);
  return root;
}

function section(title: string, meta: string, rows: HTMLElement[]): HTMLElement {
  const root = el('section', 'v2-ins-section');
  const heading = el('div', 'v2-ins-section-title');
  heading.append(el('span', undefined, title), el('span', 'meta', meta));
  root.append(heading, ...rows);
  return root;
}

function row(label: string, value: string): HTMLElement {
  const root = el('div', 'v2-ins-row');
  root.append(el('label', undefined, label), el('input', 'v2-ins-input') as HTMLInputElement);
  const input = root.querySelector<HTMLInputElement>('input');
  if (input) {
    input.value = value;
    input.readOnly = true;
  }
  return root;
}

function knobs(items: Array<[string, string]>): HTMLElement {
  const root = el('div', 'v2-knob-row');
  items.forEach(([label, value]) => {
    const cell = el('div', 'v2-knob-cell');
    cell.append(el('div', 'v2-knob-label', label), el('div', 'v2-knob-face'), el('div', 'v2-knob-val', value));
    root.append(cell);
  });
  return root;
}

function fxList(): HTMLElement {
  const root = el('div', 'v2-fx-list');
  ['EQ Paramétrique', 'De-esser', 'Compresseur', 'Reverb'].forEach((name, index) => {
    const item = el('div', `v2-fx-item${index === 0 ? ' selected' : index === 3 ? ' off' : ''}`);
    item.append(el('span', 'v2-fx-drag', '⋮⋮'), el('span', 'v2-fx-name', name), el('span', `v2-switch-mini${index === 3 ? ' off' : ''}`));
    root.append(item);
  });
  const add = el('button', 'v2-add-fx', '+ Ajouter un effet');
  add.type = 'button';
  root.append(add);
  return root;
}
