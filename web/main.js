import { createSpeechInput, isSpeechSupported } from './speech-input.js';

const landing = document.getElementById('landing');
const onboarding = document.getElementById('onboarding');
const chat = document.getElementById('chat');
const messages = document.getElementById('messages');
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

let lastIntent = null;
let pendingConfirmationToken = null;
let busy = false;
let listening = false;
let thinkingEl = null;
let listeningEl = null;

const DEFAULT_CALENDAR_QUERY = "What's on my calendar?";

const speechInput = createSpeechInput({
  onInterim(transcript) {
    if (utteranceInput) utteranceInput.value = transcript;
  },
  onFinal(transcript) {
    if (utteranceInput) utteranceInput.value = transcript;
  },
  onError(message) {
    if (message) addMessage(message, 'bot');
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
  [landing, onboarding, chat].forEach((s) => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

function addMessage(text, role) {
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

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  return { res, data: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
}

function clearWelcomeParam() {
  if (new URLSearchParams(window.location.search).has('welcome')) {
    window.history.replaceState({}, '', '/');
  }
}

async function sendVoiceMessage(utterance, { showUserMessage = true, busyMessage = 'Working on it…' } = {}) {
  if (showUserMessage) addMessage(utterance, 'user');
  confirmCard?.classList.add('hidden');
  pendingConfirmationToken = null;

  setBusy(busyMessage);
  try {
    const { res, data } = await api('/voice', {
      method: 'POST',
      body: JSON.stringify({ utterance }),
    });

    if (res.status === 401) {
      show(landing);
      return false;
    }
    if (res.status === 503) {
      addMessage(data?.error ?? 'Caladdin is temporarily unavailable. Try again in 30 seconds.', 'bot');
      return false;
    }

    lastIntent = data?.intent;
    addMessage(data?.messageToUser ?? 'Done.', 'bot');

    if (data?.requiresConfirmation) {
      pendingConfirmationToken = data.confirmationToken ?? null;
      if (confirmText) confirmText.textContent = data.messageToUser;
      confirmCard?.classList.remove('hidden');
    }

    return true;
  } finally {
    clearBusy();
  }
}

async function loadDefaultCalendar() {
  await sendVoiceMessage(DEFAULT_CALENDAR_QUERY, {
    showUserMessage: false,
    busyMessage: 'Fetching calendar data…',
  });
}

async function openChat({ loadCalendar = true } = {}) {
  show(chat);
  clearWelcomeParam();
  setupVoiceUi();
  if (loadCalendar) {
    await loadDefaultCalendar();
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

async function init() {
  setupVoiceUi();
  const { res } = await api('/auth/me');
  if (res.ok) {
    const onboarded = localStorage.getItem('caladdin_onboarded');
    if (!onboarded) {
      show(onboarding);
      clearWelcomeParam();
    } else {
      await openChat();
    }
  } else {
    show(landing);
  }
}

document.getElementById('finish-onboarding')?.addEventListener('click', async () => {
  localStorage.setItem('caladdin_onboarded', '1');
  await openChat();
});

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy || listening) return;
  const utterance = utteranceInput.value.trim();
  if (!utterance) return;
  utteranceInput.value = '';
  await sendVoiceMessage(utterance, { busyMessage: 'Thinking…' });
});

micBtn?.addEventListener('click', () => {
  if (!isSpeechSupported()) {
    addMessage('Voice input is not supported in this browser. Use Chrome or Edge.', 'bot');
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
    pendingConfirmationToken = null;

    if (res.status === 403 || res.status === 404 || res.status === 409 || res.status === 410 || !res.ok) {
      addMessage(data?.error ?? data?.messageToUser ?? data?.reason ?? `Request failed (${res.status}).`, 'bot');
      return;
    }

    if (action === 'reject') {
      addMessage('Action cancelled.', 'bot');
      return;
    }

    const result = data?.result;
    const message = data?.messageToUser ?? result?.messageToUser ?? data?.reason;
    if (data?.executionStatus === 'failed' || result?.success === false) {
      addMessage(message ?? 'That action could not be completed.', 'bot');
      return;
    }
    addMessage(message ?? 'Something went wrong — no result from server.', 'bot');
  } finally {
    clearBusy();
  }
}

confirmApprove?.addEventListener('click', () => handleConfirmation('approve'));
confirmReject?.addEventListener('click', () => handleConfirmation('reject'));

document.getElementById('logout')?.addEventListener('click', async () => {
  if (busy || listening) return;
  clearListening();
  await api('/auth/session', { method: 'DELETE' });
  localStorage.removeItem('caladdin_onboarded');
  messages.innerHTML = '';
  show(landing);
});

async function sendFeedback(rating) {
  if (!lastIntent || busy || listening) return;
  await api('/feedback', {
    method: 'POST',
    body: JSON.stringify({ rating, intent: lastIntent }),
  });
}

thumbsUp?.addEventListener('click', () => sendFeedback('up'));
thumbsDown?.addEventListener('click', () => sendFeedback('down'));

init();
