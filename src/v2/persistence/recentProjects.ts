const STORAGE_KEY = 'loadlink:v2:recent-projects';

export function getRecentProjects(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

export function addRecentProject(path: string): void {
  const next = [path, ...getRecentProjects().filter((item) => item !== path)].slice(0, 8);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
