import { describe, it, expect } from 'vitest';
import { toNtfyHeaderValue } from '../../src/services/notifications.js';

describe('toNtfyHeaderValue', () => {
  it('replaces em dash with ASCII hyphen', () => {
    const title = 'Caladdin — Confirm action';
    expect(toNtfyHeaderValue(title)).toBe('Caladdin - Confirm action');
    expect(toNtfyHeaderValue(title).charCodeAt(9)).toBeLessThanOrEqual(255);
  });

  it('strips characters outside ISO-8859-1', () => {
    expect(toNtfyHeaderValue('Hello 🎉')).toBe('Hello ??');
  });
});
