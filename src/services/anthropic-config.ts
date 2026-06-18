export type ClassifiedIntent = {
  intent: string;
  confidence: number;
  params: Record<string, unknown>;
  mappingMethod?: 'direct' | 'fuzzy' | 'resolve_manual';
  rawUtterance?: string;
};

/** @deprecated Legacy Haiku classifier retired — kept for type compatibility. */
export function resolveAnthropicClassifyModel(): string {
  return 'legacy-retired';
}
