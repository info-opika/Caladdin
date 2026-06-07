import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: any) => void;

class FakeClassList {
  private classes = new Set<string>();

  constructor(initial: string[] = []) {
    for (const value of initial) this.classes.add(value);
  }

  add(...values: string[]) {
    for (const value of values) this.classes.add(value);
  }

  remove(...values: string[]) {
    for (const value of values) this.classes.delete(value);
  }

  contains(value: string) {
    return this.classes.has(value);
  }
}

class FakeElement {
  id: string;
  hidden = false;
  disabled = false;
  value = '';
  textContent = '';
  innerHTML = '';
  className = '';
  title = '';
  scrollTop = 0;
  scrollHeight = 0;
  classList: FakeClassList;
  children: FakeElement[] = [];
  private parent: FakeElement | null = null;
  private attributes = new Map<string, string>();
  private listeners = new Map<string, Listener[]>();

  constructor(id: string, initialClasses: string[] = []) {
    this.id = id;
    this.classList = new FakeClassList(initialClasses);
  }

  addEventListener(type: string, listener: Listener) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  dispatch(type: string, payload: Record<string, unknown> = {}) {
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...payload,
    };

    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }

    return event;
  }

  appendChild(child: FakeElement) {
    child.parent = this;
    this.children.push(child);
    this.scrollHeight += 1;
    this.scrollTop = this.scrollHeight;
    return child;
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  focus() {}

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}

function makeJsonResponse(status: number, body: Record<string, unknown> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: () => 'application/json',
    },
    json: async () => body,
  };
}

function createDom() {
  const hiddenByDefault = new Set(['onboarding', 'chat', 'reconnect-banner', 'confirm-card', 'status-bar', 'voice-hint']);
  const ids = [
    'landing',
    'onboarding',
    'chat',
    'messages',
    'chat-form',
    'utterance',
    'send-btn',
    'mic-btn',
    'voice-hint',
    'confirm-card',
    'confirm-text',
    'confirm-approve',
    'confirm-reject',
    'status-bar',
    'status-text',
    'thumbs-up',
    'thumbs-down',
    'finish-onboarding',
    'logout',
    'reconnect-banner',
  ];

  const elements = new Map<string, FakeElement>();
  for (const id of ids) {
    elements.set(id, new FakeElement(id, hiddenByDefault.has(id) ? ['hidden'] : []));
  }

  const documentStub = {
    cookie: 'caladdin_csrf=test-csrf-token',
    getElementById(id: string) {
      return elements.get(id) ?? null;
    },
    createElement(tagName: string) {
      return new FakeElement(tagName);
    },
  };

  return { elements, documentStub };
}

type HarnessOptions = {
  speechSupported: boolean;
  fetchImpl?: (url: string, options?: Record<string, unknown>) => Promise<any>;
};

async function setupMainHarness(options: HarnessOptions) {
  vi.resetModules();

  const { elements, documentStub } = createDom();
  const fetchImpl =
    options.fetchImpl ??
    (async (url: string) => {
      if (url === '/auth/me') return makeJsonResponse(401, {});
      if (url === '/api/csrf-token') return makeJsonResponse(200, { csrfToken: 'test-csrf-token' });
      if (url === '/voice') return makeJsonResponse(200, { messageToUser: 'ok' });
      return makeJsonResponse(200, {});
    });

  const fetchMock = vi.fn(fetchImpl);
  const storage = new Map<string, string>();
  let speechListening = false;
  let capturedSpeechOptions: Record<string, any> = {};

  const speechController = {
    isSupported: true,
    isListening: () => speechListening,
    start: vi.fn(() => {
      speechListening = true;
    }),
    stop: vi.fn(() => {
      speechListening = false;
    }),
    toggle: vi.fn(() => {
      if (speechListening) {
        speechListening = false;
        return false;
      }
      speechListening = true;
      return true;
    }),
  };

  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('window', { location: { search: '' }, history: { replaceState: vi.fn() } });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
  });

  vi.doMock('../../web/speech-input.js', () => ({
    isSpeechSupported: vi.fn(() => options.speechSupported),
    createSpeechInput: vi.fn((speechOptions: Record<string, any>) => {
      capturedSpeechOptions = speechOptions;
      return speechController;
    }),
  }));

  await import('../../web/main.js');
  await Promise.resolve();

  return {
    elements,
    fetchMock,
    speechController,
    getSpeechOptions: () => capturedSpeechOptions,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unmock('../../web/speech-input.js');
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('voice UI STT integration', () => {
  it('keeps review-first behavior: onFinal fills input without auto-posting /voice', async () => {
    const harness = await setupMainHarness({ speechSupported: true });
    const utterance = harness.elements.get('utterance');
    const speechOptions = harness.getSpeechOptions();

    speechOptions.onFinal?.('book standup tomorrow');

    expect(utterance?.value).toBe('book standup tomorrow');
    const voiceCalls = harness.fetchMock.mock.calls.filter(([url]) => url === '/voice');
    expect(voiceCalls).toHaveLength(0);
  });

  it('blocks form submit while listening', async () => {
    const harness = await setupMainHarness({ speechSupported: true });
    const form = harness.elements.get('chat-form');
    const utterance = harness.elements.get('utterance');
    const speechOptions = harness.getSpeechOptions();

    speechOptions.onStateChange?.('listening');
    if (utterance) utterance.value = 'please schedule lunch';
    form?.dispatch('submit');

    const voiceCalls = harness.fetchMock.mock.calls.filter(([url]) => url === '/voice');
    expect(voiceCalls).toHaveLength(0);
  });

  it('disables mic while busy after submit starts', async () => {
    const pendingVoice = new Promise(() => {});
    const harness = await setupMainHarness({
      speechSupported: true,
      fetchImpl: async (url: string) => {
        if (url === '/auth/me') return makeJsonResponse(401, {});
        if (url === '/api/csrf-token') return makeJsonResponse(200, { csrfToken: 'test-csrf-token' });
        if (url === '/voice') return pendingVoice;
        return makeJsonResponse(200, {});
      },
    });

    const form = harness.elements.get('chat-form');
    const utterance = harness.elements.get('utterance');
    const micBtn = harness.elements.get('mic-btn');

    if (utterance) utterance.value = 'show my calendar';
    form?.dispatch('submit');

    expect(micBtn?.disabled).toBe(true);
  });

  it('hides mic on unsupported browsers and shows fallback message on click', async () => {
    const harness = await setupMainHarness({ speechSupported: false });
    const micBtn = harness.elements.get('mic-btn');
    const voiceHint = harness.elements.get('voice-hint');
    const messages = harness.elements.get('messages');

    expect(micBtn?.hidden).toBe(true);
    expect(voiceHint?.classList.contains('hidden')).toBe(true);

    micBtn?.dispatch('click');
    const lastMessage = messages?.children[messages.children.length - 1];
    expect(lastMessage?.textContent).toContain('Voice input is not supported in this browser');
  });
});
