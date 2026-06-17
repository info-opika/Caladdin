import { getUserByEmail } from '../db/users.js';
import { getOAuthClientForUser } from '../services/auth_service.js';

export type InviteeAvailability = {
  isCaladdinUser: boolean;
  hasCalendarConnected: boolean;
  userId?: string;
};

export async function lookupInviteeAvailability(email: string): Promise<InviteeAvailability> {
  const normalized = email.trim();
  if (!normalized) {
    return { isCaladdinUser: false, hasCalendarConnected: false };
  }

  const user = await getUserByEmail(normalized);
  if (!user) {
    return { isCaladdinUser: false, hasCalendarConnected: false };
  }

  const cal = await getOAuthClientForUser(user.id);
  return {
    isCaladdinUser: true,
    hasCalendarConnected: Boolean(cal),
    userId: user.id,
  };
}
