/** Shared UI helpers — toasts, focus-visible utilities */

let toastRoot = null;

function ensureToastRoot() {
  if (toastRoot) return toastRoot;
  toastRoot = document.getElementById('toast-root');
  if (!toastRoot && document.body) {
    toastRoot = document.createElement('div');
    toastRoot.id = 'toast-root';
    toastRoot.className = 'toast-root';
    toastRoot.setAttribute('aria-live', 'polite');
    toastRoot.setAttribute('aria-relevant', 'additions');
    document.body.appendChild(toastRoot);
  }
  return toastRoot;
}

/**
 * @param {string} message
 * @param {'info'|'success'|'error'} [variant]
 * @param {{ durationMs?: number }} [options]
 */
export function showToast(message, variant = 'info', options = {}) {
  const root = ensureToastRoot();
  if (!root) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${variant}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  root.appendChild(toast);

  const duration = options.durationMs ?? (variant === 'error' ? 6000 : 4000);
  window.setTimeout(() => {
    toast.classList.add('toast-leaving');
    window.setTimeout(() => toast.remove(), 220);
  }, duration);
}

export function detectBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
  } catch {
    return 'America/Chicago';
  }
}

export const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
];
