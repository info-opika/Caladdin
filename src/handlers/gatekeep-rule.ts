import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { ensureDefaultPolicy, upsertPolicy } from '../db/users.js';

export async function handleGatekeepRule(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  _cal: unknown,
): Promise<IntentResult> {
  const policy = await ensureDefaultPolicy(ctx.userId);
  const contact = (parsed.params.contact as string) ?? 'unknown@example.com';
  let tier = parsed.params.tier as number | undefined;
  if (tier === undefined) {
    const t = String(parsed.params.tierLabel ?? '').toLowerCase();
    if (t.includes('sacred') || t.includes('0')) tier = 0;
    else if (t.includes('high') || t.includes('1')) tier = 1;
    else if (t.includes('flex') || t.includes('3')) tier = 3;
    else tier = 2;
  }

  const idx = policy.gatekeepRules.findIndex((r) => r.contact === contact);
  if (idx >= 0) policy.gatekeepRules[idx].tier = tier;
  else policy.gatekeepRules.push({ contact, tier });

  await upsertPolicy(ctx.userId, policy);

  return {
    intent: 'GATEKEEP_RULE',
    success: true,
    requiresConfirmation: false,
    messageToUser: `Updated priority for ${contact} to tier ${tier}.`,
    schemaVersion: 1,
  };
}
