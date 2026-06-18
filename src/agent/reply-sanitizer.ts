const REASONING_LEAK_START =
  /^(?:okay|ok),?\s+the\s+user\s+(?:said|wants|is|asked|mentioned)|^let me (?:think|analyze|check)/i;

/** Remove model chain-of-thought that leaked into the user-visible reply. */
export function stripLlmReasoningLeak(reply: string): string {
  let out = reply.replace(/[\s\S]*?<\/think>/gi, '').trim();
  if (!out) return reply.trim();

  if (!REASONING_LEAK_START.test(out)) return out;

  const paragraphs = out.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const clean = paragraphs.filter((p) => !REASONING_LEAK_START.test(p));
  if (clean.length > 0) return clean.join('\n\n');

  const sentences = out.split(/(?<=[.!?])\s+/);
  const fromUserFacing = sentences.findIndex(
    (s) => !REASONING_LEAK_START.test(s) && !/^I (?:need|should|will|'ll)\b/i.test(s),
  );
  if (fromUserFacing >= 0) {
    return sentences.slice(fromUserFacing).join(' ').trim();
  }

  return out;
}
