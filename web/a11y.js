/** Accessibility helpers — focus trap, confirm dialog */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @param {HTMLElement} container
 * @returns {() => void}
 */
export function createFocusTrap(container) {
  const previous = document.activeElement;

  function getFocusable() {
    return [...container.querySelectorAll(FOCUSABLE)].filter(
      (el) => el instanceof HTMLElement && el.offsetParent !== null,
    );
  }

  function handleKeyDown(e) {
    if (e.key !== 'Tab') return;
    const items = getFocusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  container.addEventListener('keydown', handleKeyDown);
  getFocusable()[0]?.focus();

  return () => {
    container.removeEventListener('keydown', handleKeyDown);
    if (previous instanceof HTMLElement) previous.focus();
  };
}

/**
 * @param {{ title: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export function showConfirmDialog(opts) {
  return new Promise((resolve) => {
    const root = document.getElementById('confirm-dialog-root') ?? document.body;
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'confirm-dialog-title');
    dialog.setAttribute('aria-describedby', 'confirm-dialog-desc');

    dialog.innerHTML = `
      <h2 id="confirm-dialog-title">${escapeHtml(opts.title)}</h2>
      <p id="confirm-dialog-desc">${escapeHtml(opts.message)}</p>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn ghost" data-action="cancel">${escapeHtml(opts.cancelLabel ?? 'Cancel')}</button>
        <button type="button" class="btn primary${opts.danger ? ' is-danger' : ''}" data-action="confirm">${escapeHtml(opts.confirmLabel ?? 'Confirm')}</button>
      </div>`;

    overlay.appendChild(dialog);
    root.appendChild(overlay);

    const release = createFocusTrap(dialog);

    function close(result) {
      release();
      overlay.remove();
      resolve(result);
    }

    dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', () => close(false));
    dialog.querySelector('[data-action="confirm"]')?.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(false);
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Global error boundary for uncaught errors in the host app.
 */
export function initErrorBoundary(onError) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('error', (event) => {
    onError?.(event.error?.message ?? event.message ?? 'Unexpected error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    onError?.(typeof reason === 'string' ? reason : reason?.message ?? 'Unexpected error');
  });
}
