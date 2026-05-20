import { PlaybackController } from '../audio/playback';
import { ProjectStore } from '../types/project';
import { button, el, formatTime } from './dom';

export function Transport(store: ProjectStore, playback: PlaybackController): HTMLElement {
  const root = el('footer', 'v2-transport');
  const left = el('div', 'v2-transport-group');
  const rewind = button('v2-t-btn', '⏮');
  const play = button('v2-t-btn play', '▶');
  const stop = button('v2-t-btn', '⏹');
  const rec = button('v2-t-btn rec', '●');
  left.append(rewind, play, stop, rec);

  const pos = el('div', 'v2-timecode-big');
  const loop = el('div', 'v2-loop-region');
  loop.append(button('v2-t-btn', '↻'), el('span', undefined, 'Loop off'));
  const lufs = el('div', 'v2-lufs-tag');
  lufs.innerHTML = '<span>LUFS</span><span><span class="val">-14.1</span> · <span class="pk">-0.6</span></span>';
  const zoom = el('input', 'v2-transport-zoom') as HTMLInputElement;
  zoom.type = 'range';
  zoom.min = '50';
  zoom.max = '300';
  zoom.value = String(store.getProject().zoom);

  rewind.addEventListener('click', () => void playback.seek(0));
  play.addEventListener('click', () => void playback.toggle());
  stop.addEventListener('click', () => playback.stop());
  zoom.addEventListener('input', () => {
    const project = store.getProject();
    store.loadProject({ ...project, zoom: Number(zoom.value) });
  });
  playback.subscribe((seconds, playing) => {
    const text = formatTime(seconds);
    pos.innerHTML = `<span>${text.slice(0, 6)}</span><span class="sec">${text.slice(6, 8)}</span><span class="fr">${text.slice(8)}</span>`;
    play.textContent = playing ? '⏸' : '▶';
  });
  store.subscribe((project) => {
    zoom.value = String(project.zoom);
  });

  root.append(left, el('div', 'v2-timecode-wrap', 'Position'), pos, loop, lufs, zoom);
  return root;
}
