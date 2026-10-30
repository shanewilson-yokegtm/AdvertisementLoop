import { randomUUID } from 'node:crypto';
import { PLAYBOOK_VERSION, type Actor, type CampaignState, type Command } from './contracts';
import { capabilities, planFingerprint } from './playbook';

export class CampaignError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function requireRole(a: Actor, min: 'creator' | 'approver') {
  const roles = ['viewer', 'creator', 'approver', 'admin'];
  if (roles.indexOf(a.role) < roles.indexOf(min)) throw new CampaignError(403, 'forbidden', `${min} permission required`);
}
export function applyCommand(current: CampaignState, command: Command, actor: Actor, now = new Date()): CampaignState {
  requireRole(actor, ['approve', 'authorize_launch'].includes(command.type) ? 'approver' : 'creator');
  if (current.status === 'closed') throw new CampaignError(409, 'closed', 'This campaign is closed. Start a new campaign for another round.');
  const state = structuredClone(current);
  const fingerprint = planFingerprint(current);
  if (command.type === 'save_notes') state.planningNotes = command.notes;
  if (command.type === 'save_brief') {
    state.brief = command.brief; state.title = command.brief.title;
    state.approval = null; state.launch = null; state.status = 'draft'; state.playbookVersion = PLAYBOOK_VERSION;
  }
  if (command.type === 'approve') {
    if (!state.brief) throw new CampaignError(400, 'missing_brief', 'Save a complete campaign memo first');
    if (command.fingerprint !== fingerprint) throw new CampaignError(409, 'stale_plan', 'The plan changed. Read and review the current memo.');
    state.approval = { actor: actor.user_id, at: now.toISOString(), fingerprint }; state.status = 'approved'; state.launch = null;
  }
  if (command.type === 'authorize_launch') {
    if (!state.brief || !state.approval || state.approval.fingerprint !== fingerprint || command.fingerprint !== fingerprint)
      throw new CampaignError(409, 'not_approved', 'Launch requires approval of this exact plan');
    if (state.launch && state.launch.fingerprint === fingerprint && Date.parse(state.launch.expiresAt) > now.getTime())
      throw new CampaignError(409, 'already_authorized', 'A launch is already authorized for this plan. Resume it rather than creating another.');
    if (Date.parse(state.brief.spendEndsAt) <= now.getTime()) throw new CampaignError(400, 'expired_schedule', 'The spending window has ended');
    state.launch = { id: randomUUID(), fingerprint, actor: actor.user_id, at: now.toISOString(),
      expiresAt: new Date(Math.min(now.getTime() + 24 * 3600_000, Date.parse(state.brief.spendEndsAt))).toISOString(), status: 'authorized', blockers: [] };
    state.status = 'launch_authorized';
  }
  if (command.type === 'attempt_launch') {
    if (!state.launch || state.launch.fingerprint !== fingerprint || Date.parse(state.launch.expiresAt) <= now.getTime())
      throw new CampaignError(409, 'authorization_required', 'Authorize the current plan before attempting launch');
    // No network call or pretend success. The handoff must implement the adapter and durable per-step receipts first.
    state.launch.status = 'blocked'; state.launch.blockers = capabilities().filter(c => state.brief?.channels.some(p => p.channel === c.channel)).map(c => `${c.channel}: ${c.reason}`);
    state.status = 'launch_blocked';
  }
  if (command.type === 'import_metrics') {
    if (!state.brief) throw new CampaignError(400, 'missing_brief', 'A memo is needed to interpret performance');
    if (command.batch.currency !== state.brief.currency || command.batch.timezone !== state.brief.timezone || command.batch.outcome !== state.brief.primaryOutcome)
      throw new CampaignError(400, 'measurement_mismatch', 'Currency, timezone and outcome must agree with the memo');
  }
  if (command.type === 'close') {
    if (!state.brief || now.getTime() < Date.parse(state.brief.analyzeAfter)) throw new CampaignError(409, 'not_due', 'Wait until the memo’s analysis date to close the campaign');
    state.status = 'closed';
  }
  state.revision += 1;
  return state;
}
