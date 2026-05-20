import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    host: '127.0.0.1',
    port: 1421,
    strictPort: false,
  },
  build: {
    outDir: 'dist-v2',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        audioV2: 'audio-v2.html',
      },
    },
  },
});
