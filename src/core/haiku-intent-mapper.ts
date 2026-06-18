import type { ClassifiedIntent } from '../services/intent-types.js';

export type HaikuMapperContext = {
  timezone: string;
  pendingTemplate?: import('./pending-intent-memory.js').PendingIntentTemplate | null;
};

/**
 * Legacy Haiku classifier — retired in favor of FreeLLMAPI scheduling agent.
 * @deprecated
 */
export async function mapUtteranceWithHaiku(
  _utterance: string,
  _ctx: HaikuMapperContext,
): Promise<ClassifiedIntent> {
  throw new Error('Legacy Haiku classifier retired — enable the scheduling agent path');
}

/** @deprecated */
export function buildHaikuMapperSystemPrompt(_timezone: string): string {
  return '';
}
