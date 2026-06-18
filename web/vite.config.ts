import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cpSync, existsSync, mkdirSync } from 'fs';

const ROOT = resolve(__dirname);
const DIST = resolve(ROOT, 'dist');

const STATIC_ASSETS = [
  'booking.css',
  'booking.js',
  'book-page.js',
  'invite.css',
  'tokens.css',
  'theme.js',
  'a11y.js',
  'availability-editor.js',
  'embed.js',
  '404.html',
  'book.html',
];

export default defineConfig({
  root: ROOT,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(ROOT, 'index.html'),
        book: resolve(ROOT, 'book.html'),
        notFound: resolve(ROOT, '404.html'),
      },
    },
  },
  plugins: [
    {
      name: 'copy-static-assets',
      closeBundle() {
        if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });
        for (const file of STATIC_ASSETS) {
          const src = resolve(ROOT, file);
          if (existsSync(src)) {
            cpSync(src, resolve(DIST, file));
          }
        }
      },
    },
  ],
  server: {
    proxy: {
      '/voice': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
      '/feedback': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/s': 'http://localhost:3000',
      '/book': 'http://localhost:3000',
    },
  },
});
