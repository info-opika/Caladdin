import type { SimulatorCategory, SimulatorItem } from './calendar-user-simulator-corpus.js';

const CAT_MIN: Partial<Record<SimulatorCategory, number>> = {
  calendar_query: 40,
  availability: 40,
  create_event: 40,
  move_reschedule: 40,
  cancel_delete: 40,
  bulk_risky: 30,
  scheduling_link: 40,
  protect_block: 30,
  ambiguous_calendar: 30,
  non_calendar: 40,
};

/** Minimum total utterances (hard gate — 10-user readiness). */
export const MIN_TOTAL_UTTERANCES = 400;
/** Corpus length is intentionally above this (`buildCalendarUserSimulatorCorpus` aggregates gauntlets + job phrase families); only floors below are asserted. */
/** Minimum tags (gauntletTag === compound_command). */
export const MIN_COMPOUND_COMMAND_ROWS = 20;

export function countByCategory(items: SimulatorItem[]): Record<SimulatorCategory, number> {
  const out = {} as Record<SimulatorCategory, number>;
  const keys: SimulatorCategory[] = [
    'calendar_query',
    'availability',
    'create_event',
    'move_reschedule',
    'cancel_delete',
    'bulk_risky',
    'scheduling_link',
    'protect_block',
    'ambiguous_calendar',
    'non_calendar',
  ];
  for (const k of keys) out[k] = 0;
  for (const i of items) {
    out[i.category] = (out[i.category] ?? 0) + 1;
  }
  return out;
}

export function assertCorpusMinimums(items: SimulatorItem[]): { total: number; byCategory: Record<SimulatorCategory, number> } {
  const total = items.length;
  if (total < MIN_TOTAL_UTTERANCES) {
    throw new Error(`Corpus too small: ${total} < ${MIN_TOTAL_UTTERANCES}`);
  }
  const byCategory = countByCategory(items);
  for (const [cat, min] of Object.entries(CAT_MIN) as [SimulatorCategory, number][]) {
    const n = byCategory[cat] ?? 0;
    if (n < min) {
      throw new Error(`Corpus category ${cat}: ${n} < ${min}`);
    }
  }
  const own = items.filter((i) => i.axis === 'own_calendar').length;
  const appt = items.filter((i) => i.axis === 'appointment_with_others').length;
  const off = items.filter((i) => i.productFamily === 'off_topic').length;
  if (own < 220) {
    throw new Error(`own_calendar axis ${own} < 220`);
  }
  if (appt < 140) {
    throw new Error(`appointment_with_others axis ${appt} < 140`);
  }
  if (off < 40) {
    throw new Error(`off_topic / non_calendar ${off} < 40`);
  }
  const compound = items.filter((i) => i.gauntletTag === 'compound_command').length;
  if (compound < MIN_COMPOUND_COMMAND_ROWS) {
    throw new Error(`compound_command rows ${compound} < ${MIN_COMPOUND_COMMAND_ROWS}`);
  }
  if (off !== byCategory.non_calendar) {
    throw new Error(`productFamily off_topic (${off}) must match non_calendar rows (${byCategory.non_calendar})`);
  }
  for (const i of items) {
    if (i.category === 'non_calendar' && i.productFamily !== 'off_topic') {
      throw new Error(`non_calendar must have productFamily off_topic: ${i.utterance.slice(0, 40)}`);
    }
    if (i.category !== 'non_calendar' && i.productFamily === 'off_topic') {
      throw new Error(`off_topic only for non_calendar: ${i.utterance.slice(0, 40)}`);
    }
    if (i.productFamily === 'own_calendar' || i.productFamily === 'appointment_with_others') {
      if (i.axis !== i.productFamily) {
        throw new Error(`axis must match productFamily for calendar rows: ${i.utterance.slice(0, 40)}`);
      }
    }
  }
  return { total, byCategory };
}
