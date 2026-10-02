import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        cms: resolve(import.meta.dirname, 'index.html'),
        assembler: resolve(import.meta.dirname, 'assembler.html'),
        public: resolve(import.meta.dirname, 'public.html'),
        collections: resolve(import.meta.dirname, 'collections.html'),
        topics: resolve(import.meta.dirname, 'topics.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/asset': 'http://127.0.0.1:5000',
      '/collections': 'http://127.0.0.1:5000',
      '/topics': 'http://127.0.0.1:5000',
      '/cms': 'http://127.0.0.1:5000',
      '/assembler': 'http://127.0.0.1:5000',
    },
  },
});
