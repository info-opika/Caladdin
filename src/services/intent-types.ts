export type ClassifiedIntent = {
  intent: string;
  confidence: number;
  params: Record<string, unknown>;
  mappingMethod?: 'direct' | 'fuzzy' | 'resolve_manual';
  rawUtterance?: string;
};
