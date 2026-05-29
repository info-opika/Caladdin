import { describe, it, expect } from 'vitest';
import {
  extractTitle,
  extractNewTitle,
  extractEventReference,
  parseStartEndFromUtterance,
  enrichCreateParams,
  enrichModifyParams,
  enrichFlushParams,
  isRenameUtterance,
  isDeleteUtterance,
  prepareParsedForExecution,
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

  it('parses starting/ending time corrections', () => {
    const p = enrichModifyParams(
      {},
      'The event is a 1 hour event starting at 8 AM Central and ending at 9 AM Central Time',
    );
    expect(p.newStart).toBeTruthy();
    expect(p.newEnd).toBeTruthy();
    const start = new Date(p.newStart as string);
    const end = new Date(p.newEnd as string);
    expect(start.getHours()).toBe(8);
    expect(end.getHours()).toBe(9);
  });

  it('extracts event title from remove utterance', () => {
    expect(extractEventReference('Remove the Test for Caladdin event please')).toBe('Test for Caladdin');
    expect(isDeleteUtterance('Remove the Test for Caladdin event please')).toBe(true);
  });

  it('enriches flush params for single delete', () => {
    const p = enrichFlushParams({}, 'Remove the Test for Caladdin event please');
    expect(p.eventTitle).toBe('Test for Caladdin');
  });

  it('prepares delete utterance as FLUSH_RANGE for execution', () => {
    const prepared = prepareParsedForExecution({
      intent: 'MODIFY_EVENT',
      confidence: 0.9,
      params: { eventTitle: 'Test for Caladdin' },
      mappingMethod: 'direct',
      rawUtterance: 'Remove the Test for Caladdin event please',
    });
    expect(prepared.intent).toBe('FLUSH_RANGE');
    expect(prepared.params.eventTitle).toBe('Test for Caladdin');
  });
});
