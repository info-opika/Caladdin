import { describe, it, expect } from 'vitest';
import {
  extractTitle,
  extractNewTitle,
  extractEventReference,
  extractEmails,
  parseStartEndFromUtterance,
  enrichCreateParams,
  enrichModifyParams,
  enrichFlushParams,
  isRenameUtterance,
  isDeleteUtterance,
  isInviteUtterance,
  isCreateEventUtterance,
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
    expect(extractNewTitle('Modify it and rename the event to Testing Caladdin')).toBe('Testing Caladdin');
    expect(isRenameUtterance('Rename the event')).toBe(true);
    expect(isRenameUtterance('Can you modify the event name and name it Testing Caladdin')).toBe(true);
  });

  it('enriches modify params for rename', () => {
    const p = enrichModifyParams({}, "Rename it to 'Test for Caladdin'");
    expect(p.newTitle).toBe('Test for Caladdin');
    const p2 = enrichModifyParams({}, 'Modify it and rename the event to Testing Caladdin');
    expect(p2.newTitle).toBe('Testing Caladdin');
    expect(p2.eventTitle).toBeUndefined();
    const p3 = enrichModifyParams({}, 'Can you modify the event name and name it Testing Caladdin');
    expect(p3.newTitle).toBe('Testing Caladdin');
  });

  it('strips LLM placeholder titles', () => {
    const p = enrichCreateParams({ title: '<UNKNOWN>' }, 'create an event tomorrow at 8 AM');
    expect(p.title).toBeUndefined();
    const p2 = enrichCreateParams({ title: '<UNKNOWN>' }, 'create an event tomorrow at 8 AM. Name it Testing Caladdin');
    expect(p2.title).toBe('Testing Caladdin');
  });

  it('extracts event description from create utterance', () => {
    const utterance = "Create an event tomorrow 7 AM and name it as 'Caladdin Invite Test' and invite a@b.com. Add an event description that the event is a test to see if the script is running properly";
    const p = enrichCreateParams({}, utterance);
    expect(p.title).toBe('Caladdin Invite Test');
    expect(p.description).toBe('that the event is a test to see if the script is running properly');
    expect(p.participants).toContain('a@b.com');
  });

  it('parses create event with duration and description with apostrophe', () => {
    const utterance = "Create a new event for 5 AM Central and 12 minutes duration. Invite kanthatbww@gmail.com and aniketde9@gmail.com and add an event description 'This is a test to see if it's able to add descriptions'";
    expect(isCreateEventUtterance(utterance)).toBe(true);
    const p = enrichCreateParams({}, utterance);
    expect(p.title).toBeUndefined();
    expect(p.description).toBe("This is a test to see if it's able to add descriptions");
    expect(p.participants).toEqual(expect.arrayContaining(['kanthatbww@gmail.com', 'aniketde9@gmail.com']));
    expect(p.start).toBeTruthy();
    expect(p.end).toBeTruthy();
    const start = new Date(p.start as string);
    const end = new Date(p.end as string);
    expect(start.getHours()).toBe(5);
    expect((end.getTime() - start.getTime()) / 60000).toBe(12);
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

  it('extracts invite emails', () => {
    expect(extractEmails('invite kanthatbww@gmail.com')).toEqual(['kanthatbww@gmail.com']);
    expect(isInviteUtterance('invite kanthatbww@gmail.com')).toBe(true);
    const p = enrichModifyParams({}, 'invite kanthatbww@gmail.com');
    expect(p.addInvitees).toEqual(['kanthatbww@gmail.com']);
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
