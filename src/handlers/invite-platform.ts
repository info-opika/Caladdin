import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { createPlatformInvite, platformInviteUrl } from '../db/platform_invites.js';
import { getUserById } from '../db/users.js';
import { sendEmail, platformInviteEmailHtml } from '../services/email.js';
import { recordUsageEvent } from '../db/usage_events.js';
import { calendar_v3 } from 'googleapis';

export async function handleInvitePlatform(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  _cal: calendar_v3.Calendar | null,
): Promise<IntentResult> {
  const email = (parsed.params.inviteeEmail as string) ?? (parsed.params.email as string);
  if (!email) {
    return {
      intent: 'INVITE_PLATFORM',
      success: false,
      requiresConfirmation: false,
      messageToUser: 'Who should I invite? Say their email address.',
      schemaVersion: 1,
    };
  }

  const user = await getUserById(ctx.userId);
  const invite = await createPlatformInvite(ctx.userId, email);
  const link = platformInviteUrl(invite.token);
  const inviterName = user?.display_name ?? user?.email ?? 'A Caladdin user';

  const sent = await sendEmail({
    to: email,
    subject: `${inviterName} invited you to Caladdin`,
    html: platformInviteEmailHtml(inviterName, link),
  });

  await recordUsageEvent(ctx.userId, 'platform_invite_sent', { inviteeEmail: email, token: invite.token });

  return {
    intent: 'INVITE_PLATFORM',
    success: sent.ok,
    requiresConfirmation: false,
    messageToUser: sent.ok
      ? `Invitation sent to ${email}. They can join at ${link}`
      : `Could not send email to ${email}. Share this link manually: ${link}`,
    schedulingLink: link,
    schemaVersion: 1,
  };
}
