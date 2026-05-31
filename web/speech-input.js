const SpeechRecognitionCtor =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export function isSpeechSupported() {
  return Boolean(SpeechRecognitionCtor);
}

export function mapSpeechError(errorCode) {
  switch (errorCode) {
    case 'not-allowed':
    case 'permission-denied':
      return 'Microphone access denied. Allow mic in browser settings or type your command.';
    case 'no-speech':
      return "I didn't hear anything. Try again.";
    case 'network':
    case 'service-not-allowed':
    case 'audio-capture':
      return "Voice input isn't available right now. Please type instead.";
    case 'aborted':
      return '';
    default:
      return 'Voice input failed. Please type your command.';
  }
}

function resolveLang(preferredLang) {
  if (preferredLang?.trim()) return preferredLang.trim();
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return 'en-US';
}

/**
 * @param {{
 *   lang?: string;
 *   onInterim?: (transcript: string) => void;
 *   onFinal?: (transcript: string) => void;
 *   onError?: (message: string) => void;
 *   onStateChange?: (state: 'idle' | 'listening') => void;
 * }} options
 */
export function createSpeechInput(options = {}) {
  if (!SpeechRecognitionCtor) {
    return {
      isSupported: false,
      isListening: () => false,
      start: () => {},
      stop: () => {},
      toggle: () => false,
    };
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = resolveLang(options.lang);

  let listening = false;
  /** True while the user has tapped mic and not tapped stop. */
  let userRequested = false;
  let accumulated = '';

  recognition.onstart = () => {
    listening = true;
    options.onStateChange?.('listening');
  };

  recognition.onresult = (event) => {
    let interim = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) {
        accumulated += text;
      } else {
        interim += text;
      }
    }

    const display = (accumulated + interim).trim();
    if (!display) return;

    if (interim) {
      options.onInterim?.(display);
    } else if (accumulated.trim()) {
      options.onFinal?.(accumulated.trim());
    }
  };

  recognition.onerror = (event) => {
    if (event.error === 'aborted') return;

    if (event.error === 'no-speech' && userRequested) {
      return;
    }

    const message = mapSpeechError(event.error);
    if (message) options.onError?.(message);
    userRequested = false;
    listening = false;
    options.onStateChange?.('idle');
  };

  recognition.onend = () => {
    listening = false;
    if (userRequested) {
      try {
        recognition.start();
      } catch {
        userRequested = false;
        options.onStateChange?.('idle');
      }
      return;
    }
    options.onStateChange?.('idle');
  };

  return {
    isSupported: true,
    isListening: () => listening || userRequested,
    start() {
      if (userRequested && listening) return;
      const freshSession = !userRequested;
      userRequested = true;
      if (freshSession) accumulated = '';
      try {
        recognition.start();
      } catch {
        userRequested = false;
        options.onError?.('Voice input failed. Please type your command.');
        options.onStateChange?.('idle');
      }
    },
    stop() {
      if (!userRequested && !listening) return;
      userRequested = false;
      try {
        recognition.stop();
      } catch {
        listening = false;
        options.onStateChange?.('idle');
      }
    },
    toggle() {
      if (listening) {
        this.stop();
        return false;
      }
      this.start();
      return true;
    },
  };
}
