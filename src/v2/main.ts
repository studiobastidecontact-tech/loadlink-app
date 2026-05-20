import { AudioV2App } from './ui/App';

const root = document.getElementById('audio-v2-root');

if (!root) {
  throw new Error('Missing #audio-v2-root');
}

new AudioV2App(root).mount();
