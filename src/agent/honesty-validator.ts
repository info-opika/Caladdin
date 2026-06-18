import type { ToolResult } from './types.js';

const SUCCESS_LANGUAGE =
  /\b(done|booked|created|sent invite|invite sent|blocked|protected|cancelled|canceled|scheduled|saved|updated your calendar)\b/i;

/** Strip success claims when any tool failed in this turn. */
export function validateHonestReply(
  reply: string,
  toolResults: Array<{ name: string; result: ToolResult }>,
): string {
  const failures = toolResults.filter((t) => !t.result.ok);
  if (failures.length === 0) return reply;

  if (!SUCCESS_LANGUAGE.test(reply)) return reply;

  const errors = failures
    .map((f) => f.result.error ?? `${f.name} failed`)
    .join('; ');

  return `That did not complete successfully: ${errors}. I did not finish that action.`;
}
