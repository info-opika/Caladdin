const landing = document.getElementById('landing');
const onboarding = document.getElementById('onboarding');
const chat = document.getElementById('chat');
const messages = document.getElementById('messages');
const form = document.getElementById('chat-form');
const utteranceInput = document.getElementById('utterance');
const confirmCard = document.getElementById('confirm-card');
const confirmText = document.getElementById('confirm-text');
let lastIntent = null;

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

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  return { res, data: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
}

async function init() {
  const { res, data } = await api('/auth/me');
  if (res.ok) {
    const onboarded = localStorage.getItem('caladdin_onboarded');
    if (!onboarded) show(onboarding);
    else show(chat);
  } else {
    show(landing);
  }
}

document.getElementById('finish-onboarding')?.addEventListener('click', () => {
  localStorage.setItem('caladdin_onboarded', '1');
  show(chat);
  addMessage('Try: "What\'s on my calendar today?" or "Block tomorrow morning for focus."', 'bot');
});

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const utterance = utteranceInput.value.trim();
  if (!utterance) return;
  addMessage(utterance, 'user');
  utteranceInput.value = '';
  confirmCard.classList.add('hidden');

  const { res, data } = await api('/voice', {
    method: 'POST',
    body: JSON.stringify({ utterance }),
  });

  if (res.status === 401) {
    show(landing);
    return;
  }
  if (res.status === 503) {
    addMessage(data?.error ?? 'Caladdin is temporarily unavailable. Try again in 30 seconds.', 'bot');
    return;
  }

  lastIntent = data?.intent;
  addMessage(data?.messageToUser ?? 'Done.', 'bot');

  if (data?.requiresConfirmation) {
    confirmText.textContent = data.messageToUser;
    confirmCard.classList.remove('hidden');
  }
});

document.getElementById('logout')?.addEventListener('click', async () => {
  await api('/auth/session', { method: 'DELETE' });
  localStorage.removeItem('caladdin_onboarded');
  messages.innerHTML = '';
  show(landing);
});

async function sendFeedback(rating) {
  if (!lastIntent) return;
  await api('/feedback', {
    method: 'POST',
    body: JSON.stringify({ rating, intent: lastIntent }),
  });
}

document.getElementById('thumbs-up')?.addEventListener('click', () => sendFeedback('up'));
document.getElementById('thumbs-down')?.addEventListener('click', () => sendFeedback('down'));

init();
