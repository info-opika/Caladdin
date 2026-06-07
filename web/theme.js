/** Theme (light / dark / system) via CSS tokens */

const STORAGE_KEY = 'caladdin-theme';

export function getStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(mode) {
  const root = document.documentElement;
  if (!root) return;
  if (mode === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', mode);
  }
  if (typeof document.querySelectorAll !== 'function') return;
  document.querySelectorAll('#theme-select, [data-theme-select]').forEach((el) => {
    if (el instanceof HTMLSelectElement) el.value = mode;
  });
}

export function setTheme(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
  applyTheme(mode);
}

export function initTheme() {
  applyTheme(getStoredTheme());
  if (typeof document.querySelectorAll !== 'function') return;
  document.querySelectorAll('#theme-select, [data-theme-select]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el instanceof HTMLSelectElement) setTheme(el.value);
    });
  });
}
