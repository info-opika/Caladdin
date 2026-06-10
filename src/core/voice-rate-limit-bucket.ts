import { tryMatchQueryCalendar } from './query-prefilter.js';
import { tryMatchSchedulingLink } from './scheduling-link-prefilter.js';

export type VoiceRateLimitBucket = 'read' | 'mutation' | 'scheduling';

const MUTATION_VERB =
  /\b(create|add|book|schedule|move|reschedule|modify|change|shift|block|protect|flush|delete|cancel|clear|remove)\b/i;

export function classifyVoiceRateLimitBucket(utterance: string | undefined): VoiceRateLimitBucket {
  const t = (utterance ?? '').trim();
  if (!t) return 'mutation';
  if (tryMatchQueryCalendar(t)) return 'read';
  if (tryMatchSchedulingLink(t)) return 'scheduling';
  if (MUTATION_VERB.test(t)) return 'mutation';
  return 'mutation';
}
