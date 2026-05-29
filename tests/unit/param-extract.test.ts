import { describe, it, expect } from 'vitest';
import {
  extractTitle,
  extractNewTitle,
  parseStartEndFromUtterance,
  enrichCreateParams,
  enrichModifyParams,
  isRenameUtterance,
} from '../../src/core/param-extract.js';

describe('param-extract', () => {
  it('extracts title from "Name it ..."', () => {
    expect(extractTitle('Can you add an event tomorrow at 8 AM. Name it Test for Caladdin')).toBe('Test for Caladdin');
  });

  it('parses tomorrow at 8 AM', () => {
    const ref = new Date('2026-05-29T12:00:00');
    const r = parseStartEndFromUtterance('add an event tomorrow at 8 AM', ref);
    expect(r).not.toBeNull();
    const start = new Date(r!.start);
    expect(start.getDate()).toBe(30);
    expect(start.getHours()).toBe(8);
  });

  it('enriches create params from utterance', () => {
    const p = enrichCreateParams({}, 'add an event tomorrow at 8 AM. Name it Test for Caladdin');
    expect(p.title).toBe('Test for Caladdin');
    expect(p.start).toBeTruthy();
    expect(p.end).toBeTruthy();
  });

  it('extracts rename target', () => {
    expect(extractNewTitle("Rename it to 'Test for Caladdin'")).toBe('Test for Caladdin');
    expect(isRenameUtterance('Rename the event')).toBe(true);
  });

  it('enriches modify params for rename', () => {
    const p = enrichModifyParams({}, "Rename it to 'Test for Caladdin'");
    expect(p.newTitle).toBe('Test for Caladdin');
  });
});
