import { Project } from '../types/project';
import { addRecentProject } from './recentProjects';

export async function saveProjectFile(project: Project): Promise<void> {
  const save = window.__TAURI__?.dialog?.save;
  const invoke = window.__TAURI__?.core?.invoke;
  if (!save || !invoke) {
    downloadProject(project);
    return;
  }
  const path = await save({
    defaultPath: `${project.name.replace(/[\\/:*?"<>|]/g, '-')}.loadlink`,
    filters: [{ name: 'LoadLink Project', extensions: ['loadlink'] }],
  });
  if (!path) return;
  await invoke('v2_write_project_file', { path, content: JSON.stringify(project, null, 2) });
  addRecentProject(path);
}

export async function loadProjectFile(): Promise<Project | null> {
  const open = window.__TAURI__?.dialog?.open;
  const invoke = window.__TAURI__?.core?.invoke<string>;
  if (!open || !invoke) return null;
  const selected = await open({
    multiple: false,
    filters: [{ name: 'LoadLink Project', extensions: ['loadlink'] }],
  });
  if (!selected) return null;
  const path = Array.isArray(selected) ? selected[0] : selected;
  if (!path) return null;
  const content = await invoke('v2_read_project_file', { path });
  addRecentProject(path);
  return JSON.parse(content) as Project;
}

function downloadProject(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name}.loadlink`;
  link.click();
  URL.revokeObjectURL(url);
}
