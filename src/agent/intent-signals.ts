import type { AgentMessage } from './types.js';

/** User wants to book or create a one-off calendar event (not a recurring block). */
export const BOOK_INTENT_RE =
  /\b(book|schedule|set up|arrange|create\s+(?:an?\s+)?event|add\s+(?:an?\s+)?event|put\s+(?:an?\s+)?event)\b/i;

export const CANCEL_INTENT_RE =
  /\b(cancel|delete|flush|remove)\b.*\b(event|meeting|appointment|calendar)\b|\b(cancel|delete)\s+(?:the\s+)?\S+/i;

export const BLOCK_INTENT_RE =
  /\b(block|protect|shield|recurring|personal time|focus time|deep work)\b/i;

export const AFFIRMATION_RE =
  /^(yes|yeah|yep|yup|sure|ok|okay|please|go ahead|do it|confirm|confirmed|sounds good|that works|correct|right|absolutely)(?:\s+(please|thanks|thank you))?\.?$/i;

const READ_ONLY_TOOLS = new Set(['get_calendar_summary', 'find_available_slots']);

export function utteranceSignals(utterance: string, history: AgentMessage[] = []): string {
  return [...history.map((m) => m.content), utterance].join(' ');
}

export function isAffirmation(utterance: string): boolean {
  return AFFIRMATION_RE.test(utterance.trim());
}

export function isCancelIntent(text: string): boolean {
  return CANCEL_INTENT_RE.test(text);
}

export function isBlockIntent(text: string): boolean {
  return BLOCK_INTENT_RE.test(text);
}

export function isBookIntent(text: string): boolean {
  return BOOK_INTENT_RE.test(text) && !isBlockIntent(text);
}

export function isWriteIntentCategory(category: string): boolean {
  return /book|invite|block|reschedule|cancel/i.test(category);
}

export function extractEventTitle(text: string): string | null {
  const named =
    text.match(/\bnamed\s+['"]([^'"]+)['"]/i) ??
    text.match(/\bcalled\s+['"]([^'"]+)['"]/i) ??
    text.match(/\btitled\s+['"]([^'"]+)['"]/i);
  if (named?.[1]) return named[1].trim();
  return null;
}

export function hasBookableTime(text: string): boolean {
  if (extractTimeRange(text)) return true;
  if (/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/i.test(text)) return true;
  if (/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)) {
    return true;
  }
  if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(text)) {
    return true;
  }
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(text)) return true;
  return false;
}

function extractTimeRange(text: string): string | null {
  const m = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b[\s\S]{0,40}?\bto\b[\s\S]{0,40}?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  if (m) {
    return `${m[1]}${m[2] ? `:${m[2]}` : ''} ${m[3]} – ${m[4]}${m[5] ? `:${m[5]}` : ''} ${m[6]}`;
  }
  const dash = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  if (dash) {
    return `${dash[1]}${dash[2] ? `:${dash[2]}` : ''} ${dash[3] ?? ''} – ${dash[4]}${dash[5] ? `:${dash[5]}` : ''} ${dash[6]}`.trim();
  }
  return null;
}

export function assistantAskedConfirmation(history: AgentMessage[]): boolean {
  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) return false;
  const t = lastAssistant.content;
  return (
    /\b(just to confirm|would you like|shall i|should i|do you want me to|go ahead and|proceed)\b/i.test(t) ||
    (/\?\s*$/.test(t.trim()) && /\b(schedule|create|book|event|time)\b/i.test(t))
  );
}

export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}
