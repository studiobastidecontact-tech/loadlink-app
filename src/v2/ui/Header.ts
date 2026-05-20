import { ProjectStore } from '../types/project';
import { button, el } from './dom';

export function Header(store: ProjectStore, onSave: () => void, onLoad: () => void): HTMLElement {
  const root = el('header', 'v2-header');
  const title = el('div', 'v2-title');
  const name = el('strong', undefined, store.getProject().name);
  const meta = el('span', undefined, 'Timeline multi-pistes');
  title.append(name, meta);

  const actions = el('div', 'v2-header-actions');
  const undo = button('v2-icon-btn', '↺', 'Annuler');
  const redo = button('v2-icon-btn', '↻', 'Refaire');
  const save = button('v2-primary-btn', 'Sauver .loadlink');
  const load = button('v2-secondary-btn', 'Charger');
  undo.addEventListener('click', () => store.undo());
  redo.addEventListener('click', () => store.redo());
  save.addEventListener('click', onSave);
  load.addEventListener('click', onLoad);
  actions.append(undo, redo, load, save);
  root.append(title, actions);

  store.subscribe((project) => {
    name.textContent = project.name;
    undo.toggleAttribute('disabled', !store.canUndo());
    redo.toggleAttribute('disabled', !store.canRedo());
  });

  return root;
}
