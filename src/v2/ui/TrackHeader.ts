import { createSelectionStore } from '../state/selectionStore';
import { ProjectStore, Track } from '../types/project';
import { button, el } from './dom';

type SelectionStore = ReturnType<typeof createSelectionStore>;

export function TrackHeader(store: ProjectStore, selection: SelectionStore, track: Track): HTMLElement {
  const root = el('div', 'v2-track-header');
  const color = el('span', 'v2-track-color');
  color.style.background = track.color;
  const name = el('input', 'v2-track-name') as HTMLInputElement;
  name.value = track.name;
  name.addEventListener('change', () => store.updateTrack(track.id, { name: name.value }));

  const mute = button('v2-track-toggle', 'M');
  const solo = button('v2-track-toggle', 'S');
  const rec = button('v2-track-toggle', 'R');
  mute.classList.toggle('active', track.muted);
  solo.classList.toggle('active', track.solo);
  rec.classList.toggle('armed', track.recArmed);
  mute.addEventListener('click', () => store.updateTrack(track.id, { muted: !track.muted }));
  solo.addEventListener('click', () => store.updateTrack(track.id, { solo: !track.solo }));
  rec.addEventListener('click', () => store.updateTrack(track.id, { recArmed: !track.recArmed }));

  const gain = el('input', 'v2-track-slider') as HTMLInputElement;
  gain.type = 'range';
  gain.min = '-60';
  gain.max = '6';
  gain.step = '1';
  gain.value = String(track.gain);
  gain.title = `Gain ${track.gain} dB`;
  gain.addEventListener('input', () => store.updateTrack(track.id, { gain: Number(gain.value) }));

  const pan = el('input', 'v2-track-slider') as HTMLInputElement;
  pan.type = 'range';
  pan.min = '-1';
  pan.max = '1';
  pan.step = '0.05';
  pan.value = String(track.pan);
  pan.title = `Pan ${track.pan}`;
  pan.addEventListener('input', () => store.updateTrack(track.id, { pan: Number(pan.value) }));

  root.addEventListener('click', () => selection.selectTrack(track.id));
  root.append(color, name, mute, solo, rec, gain, pan);
  return root;
}
