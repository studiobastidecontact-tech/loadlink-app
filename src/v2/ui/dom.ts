export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(className: string, text: string, title?: string): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  if (title) node.title = title;
  return node;
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 100);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function isAudioPath(path: string): boolean {
  return /\.(wav|mp3|m4a|aac|flac|ogg|opus|aiff?|wma)$/i.test(path);
}

export function isVideoPath(path: string): boolean {
  return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(path);
}
