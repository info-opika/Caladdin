import type { UserPolicyProfile } from '../core/adts.js';
import { upsertPolicy } from './users.js';

export async function upsertUserPolicy(userId: string, profile: UserPolicyProfile): Promise<void> {
  await upsertPolicy(userId, profile);
}
