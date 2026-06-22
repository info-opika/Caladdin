import type { ToolResult } from './types.js';

const SUCCESS_LANGUAGE =
  /\b(done|booked|created|sent invite|invite sent|blocked|protected|cancelled|canceled|scheduled|saved|updated your calendar)\b/i;

function deniesCapabilities(reply: string): boolean {
  if (/\b(don'?t|do not)\s+have\b[\s\S]{0,120}\b(tool|create|event)\b/i.test(reply)) return true;
  if (/\bcan'?t\s+create\b/i.test(reply)) return true;
  if (/\bno\s+working\s+event\b/i.test(reply)) return true;
  if (/\bonly\s+(read|can\s+read)\b/i.test(reply) && /\bcalendar\b/i.test(reply)) return true;
  if (/\bnot\s+available\s+in\s+my\b[\s\S]{0,60}\btools?\b/i.test(reply)) return true;
  return false;
}

export type HonestyValidatorOptions = {
  readyToAct?: boolean;
  activeTools?: string[];
};

/** Strip success claims when any tool failed; block false "I lack tools" denials. */
export function validateHonestReply(
  reply: string,
  toolResults: Array<{ name: string; result: ToolResult }>,
  options: HonestyValidatorOptions = {},
): string {
  const failures = toolResults.filter((t) => !t.result.ok);

  if (toolResults.length === 0 && options.readyToAct && deniesCapabilities(reply)) {
    const tools = options.activeTools?.length
      ? options.activeTools.join(', ')
      : 'create_event and other scheduling tools';
    return `I have ${tools} available and enough details to act — retrying that now.`;
  }

  if (failures.length === 0) return reply;

  if (!SUCCESS_LANGUAGE.test(reply)) return reply;

  const errors = failures
    .map((f) => f.result.error ?? `${f.name} failed`)
    .join('; ');

  return `That did not complete successfully: ${errors}. I did not finish that action.`;
}
