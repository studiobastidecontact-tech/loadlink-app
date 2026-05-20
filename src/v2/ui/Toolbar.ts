import { createSelectionStore } from '../state/selectionStore';
import { ProjectStore } from '../types/project';
import { button, el } from './dom';

type SelectionStore = ReturnType<typeof createSelectionStore>;

export function Toolbar(store: ProjectStore, selection: SelectionStore, onImport: () => void): HTMLElement {
  const root = el('div', 'v2-toolbar');
  const select = button('v2-tool active', '↖', 'Sélection');
  const split = button('v2-tool', '✂', 'Ciseaux');
  const trim = button('v2-tool', '⇤', 'Trim');
  const fade = button('v2-tool', '◢', 'Fades');
  const addTrack = button('v2-secondary-btn', '+ Piste');
  const importAudio = button('v2-primary-btn', 'Importer audio');
  const marker = button('v2-secondary-btn', '+ Marker');

  const tools = [
    { button: select, tool: 'select' as const },
    { button: split, tool: 'split' as const },
    { button: trim, tool: 'trim' as const },
    { button: fade, tool: 'fade' as const },
  ];
  tools.forEach((item) => item.button.addEventListener('click', () => selection.setTool(item.tool)));
  addTrack.addEventListener('click', () => store.addTrack('audio'));
  importAudio.addEventListener('click', onImport);
  marker.addEventListener('click', () => store.addMarker(store.getPlayhead(), 'Marker'));
  root.append(select, split, trim, fade, el('span', 'v2-toolbar-spacer'), marker, addTrack, importAudio);

  selection.subscribe((state) => {
    tools.forEach((item) => item.button.classList.toggle('active', item.tool === state.tool));
  });

  return root;
}
