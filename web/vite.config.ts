import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/voice': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
      '/feedback': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
