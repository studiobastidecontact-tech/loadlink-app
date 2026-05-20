import { PlaybackController } from '../audio/playback';
import { ProjectStore } from '../types/project';
import { button, el, formatTime } from './dom';

export function Transport(store: ProjectStore, playback: PlaybackController): HTMLElement {
  const root = el('footer', 'v2-transport');
  const play = button('v2-play-btn', '▶');
  const stop = button('v2-secondary-btn', 'Stop');
  const time = el('span', 'v2-time', '00:00.00');
  const zoom = el('input', 'v2-zoom') as HTMLInputElement;
  zoom.type = 'range';
  zoom.min = '30';
  zoom.max = '220';
  zoom.value = String(store.getProject().zoom);
  zoom.addEventListener('input', () => {
    const project = store.getProject();
    store.loadProject({ ...project, zoom: Number(zoom.value) });
  });
  play.addEventListener('click', () => {
    void playback.toggle();
  });
  stop.addEventListener('click', () => playback.stop());
  playback.subscribe((seconds, playing) => {
    time.textContent = formatTime(seconds);
    play.textContent = playing ? '⏸' : '▶';
  });
  root.append(play, stop, time, el('span', 'v2-transport-label', 'Zoom'), zoom);
  return root;
}
