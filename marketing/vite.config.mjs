import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        landing: resolve(projectRoot, 'index.html'),
        poster: resolve(projectRoot, 'poster.html'),
      },
    },
  },
});
