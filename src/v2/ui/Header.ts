import { ProjectStore } from '../types/project';
import { button, el } from './dom';

export function Header(store: ProjectStore, onSave: () => void, onLoad: () => void): HTMLElement {
  const root = el('header', 'v2-header');
  const back = button('v2-back-btn', '←', 'Retour');
  const title = el('div', 'v2-h-title');
  const name = el('div', 'v2-h-title-main', store.getProject().name);
  const sub = el('div', 'v2-h-title-sub');
  title.append(name, sub);

  const levels = el('div', 'v2-level-switch');
  ['Débutant', 'Amateur', 'Pro'].forEach((label) => {
    const item = button(`v2-level-btn${label === 'Pro' ? ' active' : ''}`, label);
    levels.append(item);
  });

  const undo = button('v2-t-btn', '↺', 'Annuler');
  const redo = button('v2-t-btn', '↻', 'Refaire');
  const load = button('v2-t-btn', 'Charger');
  const save = button('v2-t-btn primary', 'Exporter');
  undo.addEventListener('click', () => store.undo());
  redo.addEventListener('click', () => store.redo());
  load.addEventListener('click', onLoad);
  save.addEventListener('click', onSave);
  root.append(back, title, levels, undo, redo, load, save);

  store.subscribe((project) => {
    name.textContent = project.name;
    sub.textContent = `Modifié maintenant · ${project.tracks.length} pistes · ${project.videoSource ? 'Vidéo 25 fps' : 'Projet audio'}`;
    undo.toggleAttribute('disabled', !store.canUndo());
    redo.toggleAttribute('disabled', !store.canRedo());
  });

  return root;
}
