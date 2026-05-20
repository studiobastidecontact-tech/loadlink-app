import { createSelectionStore } from '../state/selectionStore';
import { ProjectStore } from '../types/project';
import { button, el } from './dom';

type SelectionStore = ReturnType<typeof createSelectionStore>;

export function Toolbar(
  store: ProjectStore,
  selection: SelectionStore,
  onImportAudio: () => void,
  onImportVideo: () => void,
  onSplitAtPlayhead: () => void,
): HTMLElement {
  const root = el('div', 'v2-toolbar');
  const tools: Array<{ label: string; title: string; tool: 'select' | 'split' | 'trim' | 'fade' }> = [
    { label: '▻', title: 'Smart tool', tool: 'select' },
    { label: '✂', title: 'Couper au playhead (S)', tool: 'split' },
    { label: '≈', title: 'Fades', tool: 'fade' },
    { label: '⇤', title: 'Trim', tool: 'trim' },
  ];
  const buttons = tools.map((tool) => {
    const item = button('v2-tool-btn', tool.label, tool.title);
    item.addEventListener('click', () => {
      selection.setTool(tool.tool);
      if (tool.tool === 'split') onSplitAtPlayhead();
    });
    return { ...tool, item };
  });
  const marker = button('v2-tool-btn', '⚑', 'Marqueur');
  const snap = button('v2-tool-btn active', '⊞', 'Snap grille');
  const ripple = button('v2-tool-btn', '↔', 'Ripple edit');
  const video = button('v2-toolbar-action', 'Vidéo');
  const audio = button('v2-toolbar-action primary', 'Audio');
  const addTrack = button('v2-toolbar-action', '+ Piste');
  const zoom = el('input', 'v2-toolbar-zoom') as HTMLInputElement;
  zoom.type = 'range';
  zoom.min = '50';
  zoom.max = '300';
  zoom.value = String(store.getProject().zoom);

  marker.addEventListener('click', () => store.addMarker(store.getPlayhead(), 'Marker'));
  snap.addEventListener('click', () => {
    const project = store.getProject();
    store.loadProject({ ...project, snapEnabled: !project.snapEnabled });
  });
  ripple.addEventListener('click', () => {
    const project = store.getProject();
    store.loadProject({ ...project, rippleEdit: !project.rippleEdit });
  });
  video.addEventListener('click', onImportVideo);
  audio.addEventListener('click', onImportAudio);
  addTrack.addEventListener('click', () => store.addTrack('audio'));
  zoom.addEventListener('input', () => {
    const project = store.getProject();
    store.loadProject({ ...project, zoom: Number(zoom.value) });
  });

  root.append(
    ...buttons.flatMap((entry, index) => index === 1 ? [el('div', 'v2-tool-divider'), entry.item] : [entry.item]),
    el('div', 'v2-tool-divider'),
    marker,
    snap,
    ripple,
    el('div', 'v2-zoom-controls', 'Zoom'),
    zoom,
    el('div', 'v2-toolbar-spacer'),
    addTrack,
    video,
    audio,
  );

  selection.subscribe((state) => {
    buttons.forEach((entry) => entry.item.classList.toggle('active', entry.tool === state.tool));
  });
  store.subscribe((project) => {
    snap.classList.toggle('active', project.snapEnabled);
    ripple.classList.toggle('active', project.rippleEdit);
    zoom.value = String(project.zoom);
  });

  return root;
}
