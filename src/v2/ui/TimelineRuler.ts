import { ProjectStore } from '../types/project';
import { el, formatTime } from './dom';

export function TimelineRuler(store: ProjectStore, onSeek: (time: number) => void): HTMLElement {
  const root = el('div', 'v2-ruler');
  root.addEventListener('click', (event) => {
    const rect = root.getBoundingClientRect();
    onSeek((event.clientX - rect.left) / store.getProject().zoom);
  });
  store.subscribe((project) => {
    root.innerHTML = '';
    root.style.width = `${project.duration * project.zoom}px`;
    const step = Math.max(1, Math.round(120 / project.zoom));
    for (let second = 0; second <= Math.ceil(project.duration); second += step) {
      const tick = el('span', 'v2-ruler-tick', formatTime(second).slice(0, 5));
      tick.style.left = `${second * project.zoom}px`;
      root.append(tick);
    }
    project.markers.forEach((marker) => {
      const flag = el('span', 'v2-marker-flag');
      flag.style.left = `${marker.time * project.zoom}px`;
      flag.style.background = marker.color;
      flag.title = marker.label;
      root.append(flag);
    });
  });
  return root;
}
