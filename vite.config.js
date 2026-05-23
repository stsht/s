import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const page = (path) => resolve(process.cwd(), path);

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    rollupOptions: {
      input: {
        db: page('db/index.html'),
        g: page('g/index.html'),
        l: page('l/index.html'),
        inv: page('inv/index.html'),
        subs: page('subs/index.html'),
      },
    },
  },
});
