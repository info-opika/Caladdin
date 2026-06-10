import { calendar_v3 } from 'googleapis';
import type { UserPolicyProfile } from '../core/adts.js';
import type { IntentResult } from '../core/adts.js';
import { asProposedAlternative, type SchedulingSessionRow } from '../db/scheduling_sessions.js';
import { listHostSessionsWithPendingProposals } from '../db/scheduling_sessions_queries.js';
import { hostAcceptProposal, hostIgnoreProposal } from './proposal_host_actions.js';

export function isHostProposalListQuery(text: string): boolean {
  const t = text.toLowerCase().trim();
  return (
    t.includes('show proposals') ||
    t.includes('any proposals') ||
    t.includes('check scheduling') ||
    t.includes('pending scheduling proposal')
  );
}

const ACCEPT_RE = /^\s*accept\s+(?:scheduling\s+)?proposal\s+(\d+)\s+([a-f0-9]{32})\s*$/i;
const IGNORE_RE = /^\s*ignore\s+(?:scheduling\s+)?proposal\s+(\d+)\s+([a-f0-9]{32})\s*$/i;

export function parseHostProposalCommand(text: string): { kind: 'accept' | 'ignore'; index: number; token: string } | null {
  const a = text.match(ACCEPT_RE);
  if (a) return { kind: 'accept', index: parseInt(a[1]!, 10), token: a[2]! };
  const i = text.match(IGNORE_RE);
  if (i) return { kind: 'ignore', index: parseInt(i[1]!, 10), token: i[2]! };
  return null;
}

export function countPendingProposalEntries(sessions: SchedulingSessionRow[]): number {
  let n = 0;
  for (const s of sessions) {
    for (const raw of s.proposed_alternatives || []) {
      const a = asProposedAlternative(raw);
      if (a.status === 'pending' || a.status == null) n++;
    }
  }
  return n;
}

export function pendingProposalTipLine(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) {
    return "You have 1 pending scheduling proposal. Type ‘show proposals’ to see it.";
  }
  return `You have ${count} pending scheduling proposals. Type ‘show proposals’ to see them.`;
}

export function formatPendingProposalsLines(sessions: SchedulingSessionRow[]): string {
  const lines: string[] = [];
  for (const s of sessions) {
    for (let i = 0; i < (s.proposed_alternatives?.length || 0); i++) {
      const alt = asProposedAlternative(s.proposed_alternatives![i]);
      if (alt.status && alt.status !== 'pending') continue;
      const who = alt.email || alt.name || 'Invitee';
      const meeting = s.invitee_email ? `meeting with ${s.invitee_email}` : 'your scheduling link';
      lines.push(`[${who}] proposed ${alt.proposedDate} at ${alt.proposedTimeWindow} for ${meeting}.`);
      lines.push(`To respond: accept proposal ${i} ${s.token}  |  ignore proposal ${i} ${s.token}`);
    }
  }
  return lines.join('\n');
}

export async function buildListProposalsResponse(userId: string): Promise<IntentResult> {
  const sessions = await listHostSessionsWithPendingProposals(userId);
  const body = formatPendingProposalsLines(sessions);
  const msg = body.trim().length > 0 ? body : 'No pending scheduling proposals right now.';
  return {
    success: true,
    intent: 'QUERY_CALENDAR',
    atomicOp: 'list_proposals',
    eventsAffected: [],
    requiresConfirmation: false,
    messageToUser: msg,
  };
}

function proposalResultToIntent(r: Awaited<ReturnType<typeof hostIgnoreProposal>>, atomicOp: string): IntentResult {
  if (r.ok) {
    return {
      success: true,
      intent: 'QUERY_CALENDAR',
      atomicOp,
      eventsAffected: [],
      requiresConfirmation: false,
      messageToUser: r.message,
    };
  }
  return {
    success: false,
    intent: 'QUERY_CALENDAR',
    atomicOp,
    eventsAffected: [],
    requiresConfirmation: false,
    messageToUser: r.message,
    failureReason: r.code,
  };
}

export async function handleHostProposalCommand(
  text: string,
  userId: string,
  cal: calendar_v3.Calendar,
  profile: UserPolicyProfile
): Promise<IntentResult | null> {
  const cmd = parseHostProposalCommand(text);
  if (!cmd) return null;

  if (cmd.kind === 'ignore') {
    const r = await hostIgnoreProposal(cmd.token, cmd.index, userId);
    return proposalResultToIntent(r, 'proposal_ignore');
  }

  const r = await hostAcceptProposal(cmd.token, cmd.index, userId, cal, profile);
  if (r.ok) {
    return proposalResultToIntent(r, 'proposal_accept');
  }
  if (r.code === 'needs_clarification') {
    return {
      success: false,
      intent: 'QUERY_CALENDAR',
      atomicOp: 'proposal_accept',
      eventsAffected: [],
      requiresConfirmation: false,
      messageToUser: r.message,
      failureReason: 'needs_clarification',
    };
  }
  return proposalResultToIntent(r, 'proposal_accept');
}
