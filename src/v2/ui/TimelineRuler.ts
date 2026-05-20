import { ProjectStore } from '../types/project';
import { el, formatTime } from './dom';

export function TimelineRuler(store: ProjectStore, onSeek: (time: number) => void): HTMLElement {
  const root = el('div', 'v2-ruler');
  root.addEventListener('click', (event) => {
    const rect = root.getBoundingClientRect();
    const project = store.getProject();
    onSeek((event.clientX - rect.left) / project.zoom);
  });
  store.subscribe((project) => {
    root.innerHTML = '';
    const seconds = Math.ceil(project.duration);
    for (let second = 0; second <= seconds; second += Math.max(1, Math.round(80 / project.zoom))) {
      const tick = el('span', 'v2-ruler-tick', formatTime(second));
      tick.style.left = `${second * project.zoom}px`;
      root.append(tick);
    }
    root.style.width = `${project.duration * project.zoom}px`;
  });
  return root;
}
