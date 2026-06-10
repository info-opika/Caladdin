/** First email-like token in text, or null. */
export function extractEmailFromText(text: string): string | null {
  const m = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  return m ? m[0]! : null;
}
