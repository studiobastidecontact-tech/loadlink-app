import { createSelectionStore } from '../state/selectionStore';
import { ProjectStore, Track } from '../types/project';
import { button, el } from './dom';

type SelectionStore = ReturnType<typeof createSelectionStore>;

export function TrackHeader(store: ProjectStore, selection: SelectionStore, track: Track): HTMLElement {
  const root = el('div', 'v2-track-header');
  const nameRow = el('div', 'v2-track-name-row');
  const dot = el('div', 'v2-track-color-dot');
  dot.style.background = track.color;
  const name = el('input', 'v2-track-name') as HTMLInputElement;
  name.value = track.name;
  name.readOnly = track.type === 'video';
  name.addEventListener('change', () => store.updateTrack(track.id, { name: name.value }));
  nameRow.append(dot, name, el('span', 'v2-track-menu', '⋯'));

  const controls = el('div', 'v2-track-controls');
  const mute = button(`v2-ms-btn${track.muted ? ' mute active' : ' mute'}`, 'M');
  const solo = button(`v2-ms-btn${track.solo ? ' solo active' : ' solo'}`, 'S');
  const rec = button(`v2-ms-btn${track.recArmed ? ' rec active' : ' rec'}`, '●');
  const gainMini = el('div', 'v2-gain-mini');
  const fill = el('div', 'v2-gain-mini-fill');
  fill.style.width = `${Math.max(0, Math.min(100, ((track.gain + 60) / 66) * 100))}%`;
  gainMini.append(fill);
  const gainVal = el('span', 'v2-gain-val', `${track.gain > 0 ? '+' : ''}${track.gain.toFixed(1)}`);
  mute.addEventListener('click', (event) => {
    event.stopPropagation();
    store.updateTrack(track.id, { muted: !track.muted });
  });
  solo.addEventListener('click', (event) => {
    event.stopPropagation();
    store.updateTrack(track.id, { solo: !track.solo });
  });
  rec.addEventListener('click', (event) => {
    event.stopPropagation();
    store.updateTrack(track.id, { recArmed: !track.recArmed });
  });
  controls.append(mute, solo);
  if (track.type !== 'video') controls.append(rec);
  controls.append(gainMini, gainVal);

  const meter = el('div', 'v2-track-meter-mini');
  meter.append(el('div', 'v2-meter-bar-mini'), el('div', 'v2-meter-bar-mini'));
  meter.querySelectorAll('.v2-meter-bar-mini').forEach((bar, index) => {
    const meterFill = el('div', 'v2-meter-bar-mini-fill');
    meterFill.style.width = `${track.muted ? 0 : 35 + index * 6}%`;
    bar.append(meterFill);
  });

  root.addEventListener('click', () => selection.selectTrack(track.id));
  root.append(nameRow);
  if (track.type === 'video') root.append(el('div', 'v2-track-sub', 'Lecture seule · preview vidéo'));
  else root.append(controls, meter);
  return root;
}
