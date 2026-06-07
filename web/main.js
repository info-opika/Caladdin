import { createSpeechInput, isSpeechSupported } from './speech-input.js';
import { showToast, detectBrowserTimezone, COMMON_TIMEZONES } from './ui.js';
import { initTheme } from './theme.js';
import { createFocusTrap, initErrorBoundary } from './a11y.js';
import {
  parseWeeklyHours,
  deriveGlobalHours,
  mountWeeklyAvailabilityEditor,
} from './availability-editor.js';

/** Lazy-loaded when user opens Booking links — keeps initial chat bundle smaller. */
let eventTypesManagerPromise;
async function getEventTypesManager() {
  if (!eventTypesManagerPromise) {
    eventTypesManagerPromise = import('./event-types.js').then(({ createEventTypesManager }) =>
      createEventTypesManager({
        api,
        onNavigate: (view) => {
          if (view === 'chat') {
            show(chat);
            setActiveNav('chat');
            getEventTypesManager().then((m) => m.close());
            settingsManager.close();
          } else if (view === 'event-types') {
            show(eventTypesScreen);
            setActiveNav('event-types');
            settingsManager.close();
            getEventTypesManager().then((m) => m.open());
          } else if (view === 'settings') {
            show(settingsScreen);
            setActiveNav('settings');
            getEventTypesManager().then((m) => m.close());
            settingsManager.open();
          }
        },
      }),
    );
  }
  return eventTypesManagerPromise;
}
const landing = document.getElementById('landing');
const onboarding = document.getElementById('onboarding');
const chat = document.getElementById('chat');
const eventTypesScreen = document.getElementById('event-types');
const settingsScreen = document.getElementById('settings');
const messages = document.getElementById('messages');
const emptyState = document.getElementById('empty-state');
const form = document.getElementById('chat-form');
const utteranceInput = document.getElementById('utterance');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn');
const voiceHint = document.getElementById('voice-hint');
const confirmCard = document.getElementById('confirm-card');
const confirmText = document.getElementById('confirm-text');
const confirmApprove = document.getElementById('confirm-approve');
const confirmReject = document.getElementById('confirm-reject');
const statusBar = document.getElementById('status-bar');
const statusText = document.getElementById('status-text');
const thumbsUp = document.getElementById('thumbs-up');
const thumbsDown = document.getElementById('thumbs-down');
const reconnectBanner = document.getElementById('reconnect-banner');
const timezoneSelect = document.getElementById('timezone');
const finishOnboardingBtn = document.getElementById('finish-onboarding');
const onboardingError = document.getElementById('onboarding-error');

let lastIntent = null;
let pendingConfirmationToken = null;
let busy = false;
let listening = false;
let thinkingEl = null;
let listeningEl = null;
let hasMessages = false;

const speechInput = createSpeechInput({
  onInterim(transcript) {
    if (utteranceInput) utteranceInput.value = transcript;
  },
  onFinal(transcript) {
    if (utteranceInput) utteranceInput.value = transcript;
  },
  onError(message) {
    if (message) {
      addMessage(message, 'bot');
      showToast(message, 'error');
    }
    clearListening();
  },
  onStateChange(state) {
    if (state === 'listening') {
      setListening(true);
    } else if (listening) {
      clearListening();
    }
  },
});

function show(el) {
  [landing, onboarding, chat, eventTypesScreen, settingsScreen].filter(Boolean).forEach((s) => s.classList.add('hidden'));
  el?.classList.remove('hidden');
}

function setActiveNav(view) {
  document.querySelectorAll('.app-nav-link').forEach((link) => {
    const isChat = link.id?.includes('nav-chat');
    const isEt = link.id?.includes('nav-event-types');
    const isSettings = link.id?.includes('nav-settings');
    const active =
      (view === 'chat' && isChat) ||
      (view === 'event-types' && isEt) ||
      (view === 'settings' && isSettings);
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function updateEmptyState() {
  if (!emptyState) return;
  emptyState.classList.toggle('hidden', hasMessages);
}

function addMessage(text, role) {
  hasMessages = true;
  updateEmptyState();
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function showThinkingMessage(message) {
  clearThinkingMessage();
  thinkingEl = document.createElement('div');
  thinkingEl.className = 'msg bot thinking';
  thinkingEl.setAttribute('role', 'status');
  thinkingEl.setAttribute('aria-live', 'polite');
  thinkingEl.innerHTML = `<span class="thinking-spinner" aria-hidden="true"></span><span>${message}</span>`;
  messages.appendChild(thinkingEl);
  messages.scrollTop = messages.scrollHeight;
}

function clearThinkingMessage() {
  thinkingEl?.remove();
  thinkingEl = null;
}

function showListeningMessage() {
  clearListeningMessage();
  listeningEl = document.createElement('div');
  listeningEl.className = 'msg bot thinking';
  listeningEl.setAttribute('role', 'status');
  listeningEl.setAttribute('aria-live', 'polite');
  listeningEl.innerHTML = '<span class="thinking-spinner" aria-hidden="true"></span><span>Listening…</span>';
  messages.appendChild(listeningEl);
  messages.scrollTop = messages.scrollHeight;
}

function clearListeningMessage() {
  listeningEl?.remove();
  listeningEl = null;
}

function setMicDisabled(disabled) {
  if (micBtn) micBtn.disabled = disabled;
}

function setListening(active) {
  listening = active;
  if (active) {
    chat?.classList.add('is-listening');
    if (statusText) statusText.textContent = 'Listening…';
    statusBar?.classList.remove('hidden');
    showListeningMessage();
    if (micBtn) {
      micBtn.classList.add('is-listening');
      micBtn.setAttribute('aria-pressed', 'true');
      micBtn.setAttribute('aria-label', 'Stop voice input');
    }
    if (sendBtn) sendBtn.disabled = true;
    setMicDisabled(false);
  } else {
    chat?.classList.remove('is-listening');
    clearListeningMessage();
    if (!busy) {
      statusBar?.classList.add('hidden');
      if (statusText) statusText.textContent = '';
    }
    if (micBtn) {
      micBtn.classList.remove('is-listening');
      micBtn.setAttribute('aria-pressed', 'false');
      micBtn.setAttribute('aria-label', 'Start voice input');
    }
    if (!busy && sendBtn) sendBtn.disabled = false;
  }
}

function clearListening() {
  if (speechInput.isListening()) speechInput.stop();
  setListening(false);
}

function setBusy(message) {
  busy = true;
  chat?.classList.add('is-busy');
  chat?.setAttribute('aria-busy', 'true');
  showThinkingMessage(message);
  if (statusText) statusText.textContent = message;
  statusBar?.classList.remove('hidden');
  if (utteranceInput) utteranceInput.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  setMicDisabled(true);
  if (thumbsUp) thumbsUp.disabled = true;
  if (thumbsDown) thumbsDown.disabled = true;
  if (confirmApprove) confirmApprove.disabled = true;
  if (confirmReject) confirmReject.disabled = true;
}

function clearBusy() {
  busy = false;
  chat?.classList.remove('is-busy');
  chat?.removeAttribute('aria-busy');
  clearThinkingMessage();
  if (!listening) {
    statusBar?.classList.add('hidden');
    if (statusText) statusText.textContent = '';
  }
  if (utteranceInput) utteranceInput.disabled = false;
  if (sendBtn) sendBtn.disabled = listening;
  setMicDisabled(listening);
  if (thumbsUp) thumbsUp.disabled = false;
  if (thumbsDown) thumbsDown.disabled = false;
  if (confirmApprove) confirmApprove.disabled = false;
  if (confirmReject) confirmReject.disabled = false;
}

let csrfToken = null;

function readCsrfFromCookie() {
  const cookie = typeof document !== 'undefined' ? document.cookie : '';
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)caladdin_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function ensureCsrfToken() {
  if (typeof document === 'undefined') return null;
  if (csrfToken) return csrfToken;
  const fromCookie = readCsrfFromCookie();
  if (fromCookie) {
    csrfToken = fromCookie;
    return csrfToken;
  }
  const { res, data } = await api('/api/csrf-token');
  if (res.ok && data?.csrfToken) {
    csrfToken = data.csrfToken;
    return csrfToken;
  }
  return null;
}

async function api(path, options = {}) {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    const token = await ensureCsrfToken();
    if (token) headers['x-csrf-token'] = token;
  }
  const res = await fetch(path, {
    credentials: 'include',
    headers,
    ...options,
  });
  return { res, data: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
}

const eventTypesManager = {
  async open() {
    const m = await getEventTypesManager();
    if (!eventTypesBound) {
      m.init();
      eventTypesBound = true;
    }
    show(eventTypesScreen);
    setActiveNav('event-types');
    await m.open();
  },
  async close() {
    if (!eventTypesManagerPromise) return;
    const m = await getEventTypesManager();
    m.close();
  },
};
let eventTypesBound = false;
let confirmFocusRelease = null;

const settingsManager = createSettingsManager({ api });

function createSettingsManager({ api: apiFn }) {
  const weeklyContainer = document.getElementById('settings-weekly-hours');
  const tzSelect = document.getElementById('settings-timezone');
  let weeklyHours = parseWeeklyHours({}, { start: '09:00', end: '18:00' });
  let initialized = false;

  function mountWeekly(fallback) {
    if (!weeklyContainer) return;
    weeklyHours = parseWeeklyHours({}, fallback);
    mountWeeklyAvailabilityEditor(weeklyContainer, { weeklyHours });
  }

  function populateSettingsTimezone(selectedTz) {
    if (!tzSelect) return;
    const detected = detectBrowserTimezone();
    const zones = [...new Set([detected, selectedTz, ...COMMON_TIMEZONES].filter(Boolean))];
    tzSelect.innerHTML = zones
      .map((tz) => `<option value="${tz}">${tz.replace(/_/g, ' ')}</option>`)
      .join('');
    tzSelect.value = selectedTz || detected;
  }

  async function loadProfile() {
    const { res, data } = await apiFn('/api/profile');
    if (!res.ok) return;
    populateSettingsTimezone(data?.timezone);
    document.querySelectorAll('input[name="settings-privacy"]').forEach((input) => {
      input.checked = input.value === (data?.privacyMode ?? 'private');
    });
    mountWeekly({
      start: data?.workingHoursStart ?? '09:00',
      end: data?.workingHoursEnd ?? '18:00',
    });
  }

  function bindEvents() {
    if (initialized) return;
    initialized = true;

    document.getElementById('save-settings-tz')?.addEventListener('click', async () => {
      const timezone = tzSelect?.value?.trim();
      if (!timezone) {
        showToast('Select a timezone', 'error');
        return;
      }
      const { res, data } = await apiFn('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ timezone }),
      });
      if (res.ok) showToast('Timezone saved', 'success');
      else showToast(data?.error ?? 'Could not save timezone', 'error');
    });

    document.getElementById('save-settings-privacy')?.addEventListener('click', async () => {
      const checked = document.querySelector('input[name="settings-privacy"]:checked');
      const privacyMode = checked?.value;
      if (!privacyMode) return;
      const { res, data } = await apiFn('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ privacyMode }),
      });
      if (res.ok) showToast('Privacy settings saved', 'success');
      else showToast(data?.error ?? 'Could not save privacy', 'error');
    });

    document.getElementById('save-settings-hours')?.addEventListener('click', async () => {
      const derived = deriveGlobalHours(weeklyHours);
      const errEl = document.getElementById('settings-hours-error');
      if (derived.workingHoursStart >= derived.workingHoursEnd) {
        errEl?.classList.remove('hidden');
        if (errEl) errEl.textContent = 'Check enabled days have valid hours.';
        return;
      }
      errEl?.classList.add('hidden');
      const { res, data } = await apiFn('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify(derived),
      });
      if (res.ok) {
        showToast('Availability saved', 'success');
        await loadProfile();
      } else {
        showToast(data?.error ?? 'Could not save availability', 'error');
      }
    });

    for (const id of ['nav-chat-st', 'nav-event-types-st', 'nav-settings-st']) {
      document.getElementById(id)?.addEventListener('click', (e) => {
        e.preventDefault();
        const view = id.includes('chat') ? 'chat' : id.includes('event-types') ? 'event-types' : 'settings';
        if (view === 'chat') {
          show(chat);
          setActiveNav('chat');
          settingsManager.close();
          eventTypesManager.close();
        } else if (view === 'event-types') {
          void eventTypesManager.open();
        } else {
          show(settingsScreen);
          setActiveNav('settings');
          eventTypesManager.close();
          settingsManager.open();
        }
      });
    }
    document.getElementById('logout-st')?.addEventListener('click', handleLogout);
  }

  return {
    async open() {
      bindEvents();
      settingsScreen?.classList.remove('hidden');
      await loadProfile();
    },
    close() {
      settingsScreen?.classList.add('hidden');
    },
  };
}

function bindConfirmFocusTrap() {
  if (!confirmCard || confirmCard.classList.contains('hidden')) {
    confirmFocusRelease?.();
    confirmFocusRelease = null;
    return;
  }
  confirmFocusRelease?.();
  confirmFocusRelease = createFocusTrap(confirmCard);
}

for (const id of ['nav-event-types', 'nav-event-types-et']) {
  document.getElementById(id)?.addEventListener('click', (e) => {
    e.preventDefault();
    void eventTypesManager.open();
  });
}

for (const id of ['nav-chat', 'nav-chat-et']) {
  document.getElementById(id)?.addEventListener('click', (e) => {
    e.preventDefault();
    show(chat);
    setActiveNav('chat');
    eventTypesManager.close();
    settingsManager.close();
  });
}

for (const id of ['nav-settings', 'nav-settings-et']) {
  document.getElementById(id)?.addEventListener('click', (e) => {
    e.preventDefault();
    show(settingsScreen);
    setActiveNav('settings');
    eventTypesManager.close();
    void settingsManager.open();
  });
}
function clearWelcomeParam() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('welcome') || params.has('pilot')) {
    window.history.replaceState({}, '', '/');
  }
}

function setReconnectBanner(visible) {
  reconnectBanner?.classList.toggle('hidden', !visible);
}

async function sendVoiceMessage(utterance, { showUserMessage = true, busyMessage = 'Working on it…', source = 'voice' } = {}) {
  if (showUserMessage) addMessage(utterance, 'user');
  confirmCard?.classList.add('hidden');
  pendingConfirmationToken = null;

  setBusy(busyMessage);
  try {
    const { res, data } = await api('/voice', {
      method: 'POST',
      body: JSON.stringify({ utterance, source }),
    });

    if (res.status === 401) {
      showToast('Your session expired. Please sign in again.', 'error');
      show(landing);
      return false;
    }
    if (res.status === 429) {
      const msg = data?.error ?? 'Too many requests. Please wait a moment.';
      addMessage(msg, 'bot');
      showToast(msg, 'error');
      return false;
    }
    if (res.status === 503) {
      const msg = data?.error ?? 'Caladdin is temporarily unavailable. Try again in 30 seconds.';
      addMessage(msg, 'bot');
      showToast(msg, 'error');
      return false;
    }

    lastIntent = data?.intent;

    if (data?.requiresConfirmation) {
      pendingConfirmationToken = data.confirmationToken ?? null;
      if (confirmText) confirmText.textContent = data.messageToUser ?? 'Please confirm this action.';
      confirmCard?.classList.remove('hidden');
      bindConfirmFocusTrap();
    } else {
      addMessage(data?.messageToUser ?? 'Done.', 'bot');
    }

    return true;
  } finally {
    clearBusy();
  }
}

function setupVoiceUi() {
  if (!micBtn) return;
  if (isSpeechSupported()) {
    voiceHint?.classList.remove('hidden');
    micBtn.hidden = false;
  } else {
    voiceHint?.classList.add('hidden');
    micBtn.hidden = true;
  }
}

function toggleSpeechInput() {
  if (busy || !isSpeechSupported()) return;
  if (speechInput.isListening()) {
    speechInput.stop();
    return;
  }
  speechInput.toggle();
}

function populateTimezoneSelect(selectedTz) {
  if (!timezoneSelect) return;
  const detected = detectBrowserTimezone();
  const zones = [...new Set([detected, selectedTz, ...COMMON_TIMEZONES].filter(Boolean))];
  timezoneSelect.innerHTML = zones
    .map((tz) => `<option value="${tz}">${tz.replace(/_/g, ' ')}</option>`)
    .join('');
  timezoneSelect.value = selectedTz || detected;
}

function getSelectedPrivacy() {
  const checked = document.querySelector('input[name="privacy"]:checked');
  return checked?.value ?? 'private';
}

function applyProfileToOnboarding(profile) {
  populateTimezoneSelect(profile?.timezone);
  const privacy = profile?.privacyMode ?? 'private';
  document.querySelectorAll('input[name="privacy"]').forEach((input) => {
    input.checked = input.value === privacy;
  });
}

async function loadProfile() {
  const { res, data } = await api('/api/profile');
  if (!res.ok) return null;
  return data;
}

async function openChat({ profile } = {}) {
  show(chat);
  clearWelcomeParam();
  setupVoiceUi();
  setReconnectBanner(profile && !profile.calendarConnected);
  updateEmptyState();
}

async function init() {
  setupVoiceUi();
  setupSuggestionChips();
  populateTimezoneSelect(detectBrowserTimezone());

  const params = new URLSearchParams(window.location.search);
  if (params.get('pilot') === 'full') {
    showWaitlistPanel();
  }
  if (params.get('pilot') === 'paused') {
    document.getElementById('pilot-paused-banner')?.classList.remove('hidden');
    document.getElementById('signup-btn')?.classList.add('hidden');
  }

  const { res } = await api('/auth/me');
  if (res.ok) {
    const profile = await loadProfile();
    if (!profile?.onboardingComplete) {
      if (profile) applyProfileToOnboarding(profile);
      show(onboarding);
      clearWelcomeParam();
    } else {
      await openChat({ profile });
    }
  } else {
    show(landing);
  }
}

async function refreshPilotStatus() {
  try {
    const { res, data } = await api('/waitlist/status');
    if (res.ok && data && !data.pilotOpen) {
      showWaitlistPanel();
    }
  } catch {
    // ignore
  }
}

function showWaitlistPanel() {
  document.getElementById('waitlist-panel')?.classList.remove('hidden');
  document.getElementById('signup-btn')?.classList.add('hidden');
}

document.getElementById('waitlist-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('waitlist-email')?.value?.trim();
  if (!email) return;
  const { res, data } = await api('/waitlist', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  const msg = document.getElementById('waitlist-msg');
  if (res.ok) {
    const text = "You're on the waitlist. We'll email you when a spot opens.";
    if (msg) msg.textContent = text;
    showToast(text, 'success');
  } else {
    const text = data?.error ?? 'Could not join waitlist.';
    if (msg) msg.textContent = text;
    showToast(text, 'error');
  }
});

finishOnboardingBtn?.addEventListener('click', async () => {
  if (finishOnboardingBtn.disabled) return;

  const timezone = timezoneSelect?.value?.trim();
  const privacyMode = getSelectedPrivacy();
  if (!timezone) {
    onboardingError?.classList.remove('hidden');
    if (onboardingError) onboardingError.textContent = 'Please select a timezone.';
    return;
  }

  onboardingError?.classList.add('hidden');
  finishOnboardingBtn.disabled = true;
  finishOnboardingBtn.classList.add('is-loading');

  try {
    const { res, data } = await api('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ timezone, privacyMode }),
    });

    if (!res.ok) {
      const text = data?.error ?? 'Could not save your preferences.';
      if (onboardingError) {
        onboardingError.textContent = text;
        onboardingError.classList.remove('hidden');
      }
      showToast(text, 'error');
      return;
    }

    showToast('Preferences saved', 'success');
    await openChat({ profile: data });
  } finally {
    finishOnboardingBtn.disabled = false;
    finishOnboardingBtn.classList.remove('is-loading');
  }
});

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy || listening) return;
  const utterance = utteranceInput.value.trim();
  if (!utterance) return;
  utteranceInput.value = '';
  await sendVoiceMessage(utterance, { busyMessage: 'Thinking…', source: 'text' });
});

micBtn?.addEventListener('click', () => {
  if (!isSpeechSupported()) {
    const msg = 'Voice input is not supported in this browser. Use Chrome or Edge.';
    addMessage(msg, 'bot');
    showToast(msg, 'info');
    return;
  }
  toggleSpeechInput();
});

async function handleConfirmation(action) {
  if (!pendingConfirmationToken || busy) return;

  const busyMessage = action === 'approve' ? 'Applying changes…' : 'Cancelling…';
  setBusy(busyMessage);

  try {
    const { res, data } = await api(`/voice/confirm/${pendingConfirmationToken}/${action}`, {
      method: 'POST',
    });

    confirmCard?.classList.add('hidden');
    bindConfirmFocusTrap();
    pendingConfirmationToken = null;

    if (res.status === 403 || res.status === 404 || res.status === 409 || res.status === 410 || !res.ok) {
      const msg = data?.error ?? data?.messageToUser ?? data?.reason ?? `Request failed (${res.status}).`;
      addMessage(msg, 'bot');
      showToast(msg, 'error');
      return;
    }

    if (action === 'reject') {
      addMessage('Action cancelled.', 'bot');
      showToast('Action cancelled', 'info');
      return;
    }

    const result = data?.result;
    const message = data?.messageToUser ?? result?.messageToUser ?? data?.reason;
    if (data?.executionStatus === 'failed' || result?.success === false) {
      const msg = message ?? 'That action could not be completed.';
      addMessage(msg, 'bot');
      showToast(msg, 'error');
      return;
    }
    addMessage(message ?? 'Done.', 'bot');
    showToast('Action completed', 'success');
  } finally {
    clearBusy();
  }
}

confirmApprove?.addEventListener('click', () => handleConfirmation('approve'));
confirmReject?.addEventListener('click', () => handleConfirmation('reject'));

async function handleLogout() {
  if (busy || listening) return;
  clearListening();
  await api('/auth/session', { method: 'DELETE' });
  hasMessages = false;
  for (const el of [...(messages?.children ?? [])]) {
    if (el.className?.includes('msg')) el.remove();
  }
  updateEmptyState();
  eventTypesManager.close();
  settingsManager.close();
  show(landing);
}

document.getElementById('logout')?.addEventListener('click', handleLogout);
document.getElementById('logout-et')?.addEventListener('click', handleLogout);
document.getElementById('logout-st')?.addEventListener('click', handleLogout);

function setupSuggestionChips() {
  if (typeof document.querySelectorAll !== 'function') return;
  document.querySelectorAll('.chip[data-prompt]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      if (busy || listening) return;
      const prompt = chip.dataset.prompt;
      if (!prompt) return;
      await sendVoiceMessage(prompt, { busyMessage: 'Thinking…', source: 'text' });
    });
  });
}

async function sendFeedback(rating) {
  if (!lastIntent || busy || listening) return;
  const { res } = await api('/feedback', {
    method: 'POST',
    body: JSON.stringify({ rating, intent: lastIntent }),
  });
  if (res.ok) {
    showToast('Thanks for your feedback', 'success');
  } else {
    showToast('Could not send feedback', 'error');
  }
}

thumbsUp?.addEventListener('click', () => sendFeedback('up'));
thumbsDown?.addEventListener('click', () => sendFeedback('down'));

initTheme();
initErrorBoundary((message) => {
  const boundary = document.getElementById('app-error-boundary');
  if (boundary) {
    boundary.textContent = message;
    boundary.classList.remove('hidden');
  }
  showToast('Something went wrong. Please refresh the page.', 'error');
});

refreshPilotStatus();
init();
