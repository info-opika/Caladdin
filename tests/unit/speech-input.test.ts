import { afterEach, describe, expect, it, vi } from 'vitest';

const SPEECH_INPUT_MODULE = '../../web/speech-input.js';

type MockRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart?: () => void;
  onresult?: (event: any) => void;
  onerror?: (event: { error: string }) => void;
  onend?: () => void;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

function buildRecognitionCtor() {
  const instances: MockRecognitionInstance[] = [];

  class MockRecognition {
    continuous = false;
    interimResults = false;
    lang = '';
    onstart?: () => void;
    onresult?: (event: any) => void;
    onerror?: (event: { error: string }) => void;
    onend?: () => void;
    start = vi.fn();
    stop = vi.fn();

    constructor() {
      instances.push(this as unknown as MockRecognitionInstance);
    }
  }

  return { MockRecognition, instances };
}

async function importSpeechInput() {
  return import(`${SPEECH_INPUT_MODULE}?spec=${Date.now()}-${Math.random()}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('speech-input module', () => {
  it('detects speech support when constructor is missing vs present', async () => {
    vi.stubGlobal('window', {});
    const unsupportedModule = await importSpeechInput();
    expect(unsupportedModule.isSpeechSupported()).toBe(false);

    const { MockRecognition } = buildRecognitionCtor();
    vi.stubGlobal('window', { SpeechRecognition: MockRecognition });
    const supportedModule = await importSpeechInput();
    expect(supportedModule.isSpeechSupported()).toBe(true);
  });

  it('maps known and unknown speech errors to friendly messages', async () => {
    vi.stubGlobal('window', {});
    const { mapSpeechError } = await importSpeechInput();

    expect(mapSpeechError('not-allowed')).toContain('Microphone access denied');
    expect(mapSpeechError('no-speech')).toBe("I didn't hear anything. Try again.");
    expect(mapSpeechError('network')).toContain("Voice input isn't available");
    expect(mapSpeechError('aborted')).toBe('');
    expect(mapSpeechError('something-else')).toBe('Voice input failed. Please type your command.');
  });

  it('routes interim text to onInterim and final text to onFinal', async () => {
    const { MockRecognition, instances } = buildRecognitionCtor();
    vi.stubGlobal('window', { SpeechRecognition: MockRecognition });

    const { createSpeechInput } = await importSpeechInput();
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    createSpeechInput({ onInterim, onFinal });

    const recognition = instances[0];
    expect(recognition.continuous).toBe(true);

    recognition.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: false, 0: { transcript: ' drafting words ' } }],
    });
    expect(onInterim).toHaveBeenCalledWith('drafting words');
    expect(onFinal).not.toHaveBeenCalled();

    recognition.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: ' final words ' } }],
    });
    expect(onFinal).toHaveBeenCalledWith('final words');
  });

  it('restarts recognition on browser onend while user has not stopped', async () => {
    const { MockRecognition, instances } = buildRecognitionCtor();
    vi.stubGlobal('window', { SpeechRecognition: MockRecognition });

    const { createSpeechInput } = await importSpeechInput();
    const onStateChange = vi.fn();
    const speech = createSpeechInput({ onStateChange });

    speech.start();
    const recognition = instances[0];
    recognition.onstart?.();
    recognition.onend?.();

    expect(recognition.start).toHaveBeenCalledTimes(2);
    expect(onStateChange).not.toHaveBeenCalledWith('idle');
    expect(speech.isListening()).toBe(true);
  });

  it('toggles start then stop during listening lifecycle', async () => {
    const { MockRecognition, instances } = buildRecognitionCtor();
    vi.stubGlobal('window', { SpeechRecognition: MockRecognition });

    const { createSpeechInput } = await importSpeechInput();
    const speech = createSpeechInput();
    const recognition = instances[0];

    expect(speech.toggle()).toBe(true);
    expect(recognition.start).toHaveBeenCalledTimes(1);

    recognition.onstart?.();
    expect(speech.isListening()).toBe(true);

    expect(speech.toggle()).toBe(false);
    expect(recognition.stop).toHaveBeenCalledTimes(1);
  });

  it('resolves language from navigator.language and falls back to en-US', async () => {
    const firstCtor = buildRecognitionCtor();
    vi.stubGlobal('window', { SpeechRecognition: firstCtor.MockRecognition });
    vi.stubGlobal('navigator', { language: 'hi-IN' });

    const firstModule = await importSpeechInput();
    firstModule.createSpeechInput();
    expect(firstCtor.instances[0].lang).toBe('hi-IN');

    const secondCtor = buildRecognitionCtor();
    vi.stubGlobal('window', { SpeechRecognition: secondCtor.MockRecognition });
    vi.stubGlobal('navigator', {});

    const secondModule = await importSpeechInput();
    secondModule.createSpeechInput();
    expect(secondCtor.instances[0].lang).toBe('en-US');
  });

  it('maps recognition onerror values to user-facing messages', async () => {
    const { MockRecognition, instances } = buildRecognitionCtor();
    vi.stubGlobal('window', { SpeechRecognition: MockRecognition });

    const { createSpeechInput } = await importSpeechInput();
    const onError = vi.fn();
    createSpeechInput({ onError });

    const recognition = instances[0];
    recognition.onerror?.({ error: 'no-speech' });
    recognition.onerror?.({ error: 'aborted' });
    recognition.onerror?.({ error: 'network' });

    expect(onError).toHaveBeenCalledWith("I didn't hear anything. Try again.");
    expect(onError).toHaveBeenCalledWith("Voice input isn't available right now. Please type instead.");
    expect(onError).not.toHaveBeenCalledWith('');
  });
});
