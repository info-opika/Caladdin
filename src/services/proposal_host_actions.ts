import { calendar_v3 } from 'googleapis';
import type { UserPolicyProfile } from '../core/adts.js';
import {
  getSchedulingSessionByToken,
  patchProposedAlternative,
  claimHostProposalForAccept,
  revertHostProposalAcceptClaim,
  PROPOSAL_ACCEPT_CLAIM_SENTINEL,
  asProposedAlternative,
} from '../db/scheduling_sessions.js';
import { createCalendarEvent } from './calendar.js';
import { gcalDeleteEvent } from './gcal.js';
import { parseProposalToStartEnd } from './proposal_time_parse.js';
import { logger } from '../logger.js';
import { recordUsageEvent } from '../db/usage_events.js';

export type HostProposalResult =
  | { ok: true; idempotent: true; googleEventId?: string; message: string }
  | { ok: true; applied: true; googleEventId?: string; message: string }
  | {
      ok: false;
      code:
        | 'not_found'
        | 'bad_index'
        | 'already_accepted'
        | 'needs_clarification'
        | 'calendar_error'
        | 'race_lost'
        | 'in_progress';
      message: string;
    };

const CLARIFY_MSG =
  'I need a clearer date (for example 2026-06-15) and time window (for example 2:00–3:00pm or 2pm) before I can add this to your calendar. Ask your invitee to resubmit, or enter the event manually.';

export async function hostIgnoreProposal(
  token: string,
  proposalIndex: number,
  hostUserId: string
): Promise<HostProposalResult> {
  const session = await getSchedulingSessionByToken(token);
  if (!session || session.host_user_id !== hostUserId) {
    return { ok: false, code: 'not_found', message: 'That scheduling link or proposal was not found.' };
  }
  const alts = session.proposed_alternatives || [];
  if (proposalIndex < 0 || proposalIndex >= alts.length) {
    return { ok: false, code: 'bad_index', message: 'Invalid proposal index.' };
  }
  const cur = asProposedAlternative(alts[proposalIndex]);
  if (cur.status === 'ignored') {
    return { ok: true, idempotent: true, message: 'That proposal was already ignored.' };
  }
  if (cur.status === 'accepted') {
    return {
      ok: false,
      code: 'already_accepted',
      message: 'That proposal was already accepted. Remove the calendar event manually if you need to change it.',
    };
  }
  if (cur.status === 'accepting' && (cur.google_event_id === PROPOSAL_ACCEPT_CLAIM_SENTINEL || !cur.google_event_id)) {
    return {
      ok: false,
      code: 'in_progress',
      message: 'An accept is already in progress for this proposal. Try again in a few seconds.',
    };
  }
  await patchProposedAlternative(token, proposalIndex, { status: 'ignored' });
  return { ok: true, applied: true, message: 'Ignored. The invitee has been noted.' };
}

export async function hostAcceptProposal(
  token: string,
  proposalIndex: number,
  hostUserId: string,
  cal: calendar_v3.Calendar,
  profile: UserPolicyProfile
): Promise<HostProposalResult> {
  const session = await getSchedulingSessionByToken(token);
  if (!session || session.host_user_id !== hostUserId) {
    return { ok: false, code: 'not_found', message: 'That scheduling link or proposal was not found.' };
  }
  const alts = session.proposed_alternatives || [];
  if (proposalIndex < 0 || proposalIndex >= alts.length) {
    return { ok: false, code: 'bad_index', message: 'Invalid proposal index.' };
  }
  const cur0 = asProposedAlternative(alts[proposalIndex]);
  if (cur0.status === 'accepted' && cur0.google_event_id && cur0.google_event_id !== PROPOSAL_ACCEPT_CLAIM_SENTINEL) {
    return {
      ok: true,
      idempotent: true,
      googleEventId: cur0.google_event_id,
      message: `That proposal was already accepted (calendar event ${cur0.google_event_id}).`,
    };
  }

  const claimed = await claimHostProposalForAccept(token, proposalIndex);
  if (!claimed) {
    const again = await getSchedulingSessionByToken(token);
    const al = again?.proposed_alternatives || [];
    const c = asProposedAlternative(al[proposalIndex]);
    if (c?.status === 'accepted' && c.google_event_id && c.google_event_id !== PROPOSAL_ACCEPT_CLAIM_SENTINEL) {
      return {
        ok: true,
        idempotent: true,
        googleEventId: c.google_event_id,
        message: `That proposal was already accepted (calendar event ${c.google_event_id}).`,
      };
    }
    if (c?.status === 'accepting' || c?.status === 'pending') {
      return { ok: false, code: 'race_lost', message: 'Another accept completed first or is in progress. Refresh and check your calendar.' };
    }
    return { ok: false, code: 'not_found', message: 'That proposal is no longer available to accept.' };
  }

  const session2 = (await getSchedulingSessionByToken(token))!;
  const alts2 = session2.proposed_alternatives || [];
  const cur = asProposedAlternative(alts2[proposalIndex]);

  const slot = parseProposalToStartEnd(
    cur.proposedDate,
    cur.proposedTimeWindow,
    session2.duration_minutes,
    session2.host_timezone || profile.timezone
  );
  if (!slot) {
    await revertHostProposalAcceptClaim(token, proposalIndex);
    return { ok: false, code: 'needs_clarification', message: CLARIFY_MSG };
  }

  const title = session2.invitee_email
    ? `Meeting with ${session2.invitee_email} (invitee proposal)`
    : 'Meeting (invitee proposal)';

  let eventId: string = '';
  try {
    const created = await createCalendarEvent(cal, {
      summary: title,
      start: slot.start,
      end: slot.end,
      attendees: cur.email ? [cur.email] : session2.invitee_email ? [session2.invitee_email] : [],
      description: cur.note ? `Invitee note: ${cur.note}` : undefined,
    });
    eventId = created.id || '';
  } catch (err) {
    logger.error('hostAcceptProposal calendar insert failed', { err: String(err), token, proposalIndex });
    await revertHostProposalAcceptClaim(token, proposalIndex);
    return {
      ok: false,
      code: 'calendar_error',
      message: 'Could not create the calendar event. Try again or add it manually in Google Calendar.',
    };
  }

  if (!eventId) {
    await revertHostProposalAcceptClaim(token, proposalIndex);
    return { ok: false, code: 'calendar_error', message: 'Calendar returned no event id. Try again.' };
  }

  try {
    await patchProposedAlternative(token, proposalIndex, { status: 'accepted', google_event_id: eventId });
    await recordUsageEvent(hostUserId, 'meeting_created', {
      sessionToken: token,
      googleEventId: eventId,
      source: 'proposal_accept',
      proposalIndex,
    });
  } catch (err) {
    logger.error('hostAcceptProposal DB finalize failed; deleting calendar orphan', { err: String(err), token, eventId });
    try {
      await gcalDeleteEvent(cal, eventId);
    } catch (delErr) {
      logger.error('Failed to delete orphan GCal event after DB failure', { delErr: String(delErr), eventId });
    }
    await revertHostProposalAcceptClaim(token, proposalIndex);
    return { ok: false, code: 'calendar_error', message: 'Could not save acceptance. Please try again.' };
  }

  return {
    ok: true,
    applied: true,
    googleEventId: eventId,
    message: `Accepted — added to your calendar (${eventId}).`,
  };
}
