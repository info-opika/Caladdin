/**
 * Caladdin embed widget stub — drop on any site to open a booking page.
 *
 * Usage:
 *   <script src="https://your-caladdin.example/embed.js" data-caladdin-url="https://your-caladdin.example/book/jane/intro-call"></script>
 */
(function caladdinEmbed() {
  const script = document.currentScript;
  if (!script) return;

  const bookingUrl = script.getAttribute('data-caladdin-url') || script.getAttribute('data-url');
  if (!bookingUrl) {
    console.warn('[Caladdin] embed.js: set data-caladdin-url to your booking link.');
    return;
  }

  const label = script.getAttribute('data-label') || 'Book a meeting';
  const theme = script.getAttribute('data-theme') || 'brand';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.setAttribute('aria-label', label);
  btn.className = 'caladdin-embed-btn';
  btn.style.cssText = [
    'font-family: system-ui, -apple-system, sans-serif',
    'font-size: 14px',
    'font-weight: 600',
    'padding: 10px 16px',
    'border-radius: 8px',
    'border: none',
    'cursor: pointer',
    theme === 'dark'
      ? 'background:#1c1917;color:#fafaf9'
      : 'background:#d97706;color:#fff',
  ].join(';');

  btn.addEventListener('click', () => {
    window.open(bookingUrl, '_blank', 'noopener,noreferrer');
  });

  script.insertAdjacentElement('afterend', btn);
})();
