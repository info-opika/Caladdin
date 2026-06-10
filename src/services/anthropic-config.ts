/** Pin via `ANTHROPIC_MODEL` — Wave 1 default is Haiku form-filler. */
export const DEFAULT_CLASSIFY_MODEL = 'claude-haiku-4-5';

export function resolveAnthropicClassifyModel(): string {
  const raw = process.env['ANTHROPIC_MODEL']?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_CLASSIFY_MODEL;
}

export type ClassifiedIntent = {
  intent: string;
  confidence: number;
  params: Record<string, unknown>;
  mappingMethod?: 'direct' | 'fuzzy' | 'resolve_manual';
  rawUtterance?: string;
};
