import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  server: {
    host: '127.0.0.1',
    port: 1421,
    strictPort: false,
  },
  build: {
    outDir: 'src/audio-v2-bundle',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        audioV2: 'audio-v2.html',
      },
    },
  },
});
