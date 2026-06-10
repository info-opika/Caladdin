import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { VALID_INTENTS } from './adts.js';
import type { PendingIntentTemplate } from './pending-intent-memory.js';
import {
  buildHaikuDateAnchor,
  formatHaikuDateAnchorBlock,
} from './haiku-date-anchor.js';
import {
  resolveAnthropicClassifyModel,
  type ClassifiedIntent,
} from '../services/anthropic-config.js';
import { logger } from '../logger.js';

const anthropic = new Anthropic({
  apiKey: config.anthropicApiKey || 'sk-placeholder',
});

export type HaikuMapperContext = {
  timezone: string;
  pendingTemplate?: PendingIntentTemplate | null;
};

/** JSON-only Haiku form-filler — does not execute calendar actions. */
export function buildHaikuMapperSystemPrompt(timezone: string, nowMs = Date.now()): string {
  const anchor = buildHaikuDateAnchor(timezone, nowMs);
  return [
    'You are Caladdin\'s calendar intent form-filler. You map user text to a strict JSON object.',
    'Output ONLY a single JSON object. No markdown, no prose, no code fences.',
    '',
    formatHaikuDateAnchorBlock(anchor),
    '',
    `Allowed intent values (exact strings): ${VALID_INTENTS.join(', ')}`,
    '',
    'Top-level JSON keys (only these):',
    '- intent (required string from allowed list)',
    '- confidence (required number 0–1)',
    '- params (required object; use {} when empty)',
    '- mappingMethod (optional: "direct" | "fuzzy" | "resolve_manual")',
    '- missingFields (optional string[] — list param names still needed, e.g. startTime, endTime, rangeEnd, label)',
    '- parseRisk (optional string — e.g. "ambiguous_time", "non_calendar")',
    '',
    'Rules:',
    '- Never invent clock times from vague words (morning, afternoon, evening, lunch, deep work, family time).',
    '- If times are vague, set intent PROTECT_BLOCK or RESOLVE_MANUAL with missingFields including startTime and endTime — do NOT fill 09:00-12:00 style defaults.',
    '- PROTECT_BLOCK when complete: label, startTime, endTime (HH:MM 24h), daysOfWeek (0=Sun–6=Sat), rangeEnd (YYYY-MM-DD), optional startDate.',
    '- SCHEDULING_LINK: inviteeEmail when present; parsedSchedulingDateRange {start,end} YYYY-MM-DD when user gives a span (e.g. next week); OR schedulingDefaultSearchWindow:true only for transactional link phrasing without a day span.',
    '- Never set windowStartHourLocal/windowEndHourLocal unless user stated an explicit same-day clock window.',
    '- QUERY_CALENDAR: params.queryType when obvious (today, tomorrow, next, availability, week_range).',
    '- WARM_REDIRECT for non-calendar requests (jokes, trivia, capital cities, weather without calendar context).',
    '- DELETE/cancel/clear everything → RESOLVE_MANUAL with reason, not destructive execution.',
    '- Low confidence (<0.6) when ambiguous; prefer RESOLVE_MANUAL with missingFields over guessing.',
    '- Do not add top-level keys beyond the list above.',
    '- No fabricated personal defaults (no implicit morning=9-12, lunch=12-1, default weekdays, default rangeEnd).',
  ].join('\n');
}

function buildHaikuUserMessage(utterance: string, ctx: HaikuMapperContext, nowMs = Date.now()): string {
  const anchor = buildHaikuDateAnchor(ctx.timezone, nowMs);
  const parts = [
    formatHaikuDateAnchorBlock(anchor),
    '',
    `User message: ${utterance}`,
  ];
  if (ctx.pendingTemplate) {
    parts.push(
      '',
      'Pending clarification template (merge new information; keep original intent):',
      JSON.stringify({
        pendingIntent: ctx.pendingTemplate.pendingIntent,
        knownFields: ctx.pendingTemplate.knownFields,
        missingFields: ctx.pendingTemplate.missingFields,
        originalUtterance: ctx.pendingTemplate.originalUtterance,
      })
    );
  }
  return parts.join('\n');
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1]!.trim() : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object in Haiku response');
  }
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Calls Anthropic Haiku to fill the ParsedIntent contract (intent, confidence, params, mappingMethod).
 */
export async function mapUtteranceWithHaiku(
  utterance: string,
  ctx: HaikuMapperContext,
  nowMs = Date.now()
): Promise<ClassifiedIntent> {
  const model = resolveAnthropicClassifyModel();
  const response = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: buildHaikuMapperSystemPrompt(ctx.timezone, nowMs),
    messages: [{ role: 'user', content: buildHaikuUserMessage(utterance, ctx, nowMs) }],
  });

  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
  }
  if (!text.trim()) {
    throw new Error('Empty Haiku mapper response');
  }

  let parsed: unknown;
  try {
    parsed = extractJsonObject(text);
  } catch (err) {
    logger.warn('Haiku mapper JSON parse failed', { err: String(err), utterancePreview: utterance.slice(0, 120) });
    throw err;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Haiku mapper output is not an object');
  }

  const o = parsed as Record<string, unknown>;
  const intent = typeof o.intent === 'string' ? o.intent : '';
  const confidence = typeof o.confidence === 'number' ? o.confidence : Number(o.confidence);
  const params =
    typeof o.params === 'object' && o.params !== null && !Array.isArray(o.params)
      ? (o.params as Record<string, unknown>)
      : {};

  const mappingMethod =
    o.mappingMethod === 'direct' || o.mappingMethod === 'fuzzy' || o.mappingMethod === 'resolve_manual'
      ? o.mappingMethod
      : undefined;

  const missingFields = Array.isArray(o.missingFields)
    ? o.missingFields.filter((x): x is string => typeof x === 'string')
    : Array.isArray(params['missingFields'])
      ? (params['missingFields'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined;

  const parseRisk = typeof o.parseRisk === 'string' ? o.parseRisk : undefined;

  return {
    intent,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    params: {
      ...params,
      ...(missingFields?.length ? { missingFields } : {}),
      ...(parseRisk ? { parseRisk } : {}),
    },
    mappingMethod,
    rawUtterance: utterance,
  };
}
