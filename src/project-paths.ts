import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Repo root whether the server runs from src/ (tsx) or dist/src/ (node). */
export function getProjectRoot(): string {
  const candidates = [join(moduleDir, '..'), join(moduleDir, '..', '..'), process.cwd()];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  return process.cwd();
}

/**
 * Static web assets: web/ in development, web/dist after `npm run build:web`.
 * When running `npm start` without NODE_ENV=production, prefer built assets if present.
 */
export function resolveWebRoot(): string {
  const root = getProjectRoot();
  const built = join(root, 'web', 'dist');
  const source = join(root, 'web');

  if (config.isProd) {
    return built;
  }

  if (existsSync(join(built, 'index.html'))) {
    return built;
  }

  return source;
}
