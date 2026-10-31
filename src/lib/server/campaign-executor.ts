// Server-only launch executor over the durable step ledger (migration 20261031001000_campaign_execution_ledger).
// Not routed to any API, tool or schedule. `attempt_launch` stays blocked and `registeredAdapters` is empty, so in
// production this module cannot reach a platform. Tests drive it with a fake adapter against local Postgres.
//
// Rules: claim and persist each step (operation id, payload hash, before-state) before calling out; a call that
// times out or errors without a definite rejection is recorded as `unknown` and must be reconciled; recheck the
// exact approved plan, authorization expiry and asset readiness before each step and again before activation;
// activate only after a recorded paused readback matched the plan.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignState, Channel, ChannelPlan } from '../campaigns/contracts';
import { DefiniteFailure, type CampaignAdapter, type ExecutionStep } from '../campaigns/adapters';
import { deploymentPlan, digest, planFingerprint } from '../campaigns/playbook';
import { assertAssetsReady } from './campaign-assets';

export const operationId = (launchId: string, channel: Channel, step: ExecutionStep) =>
  `yx_${digest({ launchId, channel, step }).slice(0, 32)}`;

export type ChannelOutcome = {
  channel: Channel;
  status: 'active' | 'blocked' | 'needs_reconciliation' | 'in_progress' | 'failed';
  step?: ExecutionStep; operationId?: string; detail: string;
};
type StepRow = { operation_id: string; status: string; attempt: number; receipt: any; platform_ids: Record<string, string> | null };
type Options = {
  db: SupabaseClient; campaignId: string; workerId: string;
  adapters: Partial<Record<Channel, CampaignAdapter>>;
  leaseSeconds?: number; stepTimeoutMs?: number; now?: () => Date;
};
class Stop extends Error { constructor(public outcome: Omit<ChannelOutcome, 'channel'>) { super(outcome.detail); } }

async function rpc(db: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const r: any = await db.rpc(fn, args);
  if (r.error) throw new Error(String(r.error.message));
  return r.data;
}

/** Reload the campaign and confirm it still holds this exact, unexpired authorization with ready assets. */
async function guard(o: Options, channel: Channel, launchId?: string): Promise<{ state: CampaignState; plan: ChannelPlan }> {
  const r: any = await o.db.from('campaign_records').select('state').eq('id', o.campaignId).maybeSingle();
  if (r.error || !r.data) throw new Stop({ status: 'blocked', detail: 'Campaign not found' });
  const state = r.data.state as CampaignState; const now = (o.now ?? (() => new Date()))().getTime();
  const fp = planFingerprint(state);
  if (state.status !== 'launch_authorized' || !state.launch || state.launch.status !== 'authorized' || !state.approval || !state.brief
    || state.approval.fingerprint !== fp || state.launch.fingerprint !== fp || (launchId && state.launch.id !== launchId))
    throw new Stop({ status: 'blocked', detail: 'Stale authorization: the plan, approval or launch authorization changed' });
  if (Date.parse(state.launch.expiresAt) <= now || Date.parse(state.brief.spendEndsAt) <= now)
    throw new Stop({ status: 'blocked', detail: 'Stale authorization: launch authorization or spending window expired' });
  try { await assertAssetsReady(o.db, state, channel); }
  catch (e: any) { throw new Stop({ status: 'blocked', detail: e.message }); }
  const plan = deploymentPlan(state).find(p => p.channel === channel);
  if (!plan) throw new Stop({ status: 'blocked', detail: `No ${channel} plan in the approved memo` });
  return { state, plan };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(t));
}

async function runStep(o: Options, adapter: CampaignAdapter, state: CampaignState, channel: Channel, step: ExecutionStep, payload: unknown,
  call: (op: string) => Promise<{ outcome: 'succeeded' | 'unknown'; receipt: Record<string, unknown>; platformIds?: Record<string, string> }>): Promise<StepRow> {
  const launch = state.launch!; const op = operationId(launch.id, channel, step);
  const before = await adapter.reconcile(op, step); // read-only evidence of the platform state before this step
  let claim: { claimed: boolean; step: StepRow };
  try {
    claim = await rpc(o.db, 'campaign_step_claim', { p_operation: op, p_campaign: state.id, p_launch: launch.id, p_channel: channel, p_step: step,
      p_fingerprint: launch.fingerprint, p_payload_hash: digest({ fingerprint: launch.fingerprint, channel, step, payload }),
      p_before: before, p_worker: o.workerId, p_lease_seconds: o.leaseSeconds ?? 120 });
  } catch (e: any) { throw new Stop({ status: 'blocked', step, operationId: op, detail: e.message }); }
  if (!claim.claimed) {
    const s = claim.step;
    if (s.status === 'succeeded') return s; // recorded earlier: reuse the receipt, never repeat the call
    if (s.status === 'claimed') throw new Stop({ status: 'in_progress', step, operationId: op, detail: 'Another worker holds this step' });
    if (s.status === 'failed') throw new Stop({ status: 'failed', step, operationId: op, detail: 'Platform rejected this step; a new authorization is needed' });
    throw new Stop({ status: 'needs_reconciliation', step, operationId: op, detail: 'Outcome unknown; reconcile against the platform before any retry' });
  }
  const attempt = claim.step.attempt;
  let outcome: 'succeeded' | 'failed' | 'unknown', receipt: Record<string, unknown>, platformIds: Record<string, string> | undefined;
  try { ({ outcome, receipt, platformIds } = await withTimeout(call(op), o.stepTimeoutMs ?? 30_000)); }
  catch (e: any) {
    outcome = e instanceof DefiniteFailure ? 'failed' : 'unknown';
    receipt = { error: String(e.message).slice(0, 500), ...(e instanceof DefiniteFailure ? { evidence: e.evidence } : {}) };
  }
  let row: StepRow;
  try { row = await rpc(o.db, 'campaign_step_complete', { p_operation: op, p_worker: o.workerId, p_attempt: attempt, p_outcome: outcome, p_receipt: receipt, p_platform_ids: platformIds ?? null }); }
  catch (e: any) { throw new Stop({ status: 'needs_reconciliation', step, operationId: op, detail: `Could not record outcome: ${e.message}` }); }
  if (outcome === 'failed') throw new Stop({ status: 'failed', step, operationId: op, detail: String(receipt.error) });
  if (outcome === 'unknown') throw new Stop({ status: 'needs_reconciliation', step, operationId: op, detail: `Outcome unknown (${receipt.error ?? 'partial'}); reconcile before any retry` });
  return row;
}

async function runChannel(o: Options, channel: Channel): Promise<ChannelOutcome> {
  const adapter = o.adapters[channel];
  if (!adapter || adapter.channel !== channel) return { channel, status: 'blocked', detail: `${channel}: firm account adapter is not connected` };
  try {
    let { state, plan } = await guard(o, channel);
    const launchId = state.launch!.id;
    const built = await runStep(o, adapter, state, channel, 'build_paused', plan, async op => {
      const r = await adapter.buildPaused(plan, op);
      return { outcome: 'succeeded', receipt: { receiptRef: r.receiptRef }, platformIds: r.platformIds };
    });
    const ids = built.platform_ids || {};
    ({ state, plan } = await guard(o, channel, launchId));
    const verified = await runStep(o, adapter, state, channel, 'verify_paused', { ids, plan }, async () => {
      const r = await adapter.verifyPaused(ids, plan);
      return { outcome: 'succeeded', receipt: { matches: r.matches, previewRefs: r.previewRefs, differences: r.differences } };
    });
    if (!verified.receipt?.matches) return { channel, status: 'blocked', step: 'verify_paused', detail: `Paused build differs from the approved plan: ${(verified.receipt?.differences || []).join('; ')}` };
    ({ state, plan } = await guard(o, channel, launchId)); // final exact-plan, expiry and asset recheck before spend
    await runStep(o, adapter, state, channel, 'activate', { ids, authorizationId: launchId }, async op => {
      const r = await adapter.activate(ids, launchId, op);
      return { outcome: r.state === 'active' ? 'succeeded' : 'unknown', receipt: { state: r.state, receiptRef: r.receiptRef } };
    });
    return { channel, status: 'active', step: 'activate', detail: 'Activated within the authorized plan' };
  } catch (e) {
    if (e instanceof Stop) return { channel, ...e.outcome };
    return { channel, status: 'needs_reconciliation', detail: `Unexpected executor error: ${(e as Error).message}` };
  }
}

/** Run (or resume) the authorized launch for every channel in the approved plan. Safe to call repeatedly. */
export async function executeLaunch(o: Options): Promise<ChannelOutcome[]> {
  const r: any = await o.db.from('campaign_records').select('state').eq('id', o.campaignId).maybeSingle();
  const channels = ((r.data?.state as CampaignState | undefined)?.brief?.channels || []).map(p => p.channel);
  const out: ChannelOutcome[] = [];
  for (const c of channels) out.push(await runChannel(o, c)); // sequential: one channel's failure never hides another's
  return out;
}

/** Resolve an `unknown` step from read-only platform evidence. Ambiguous evidence stays unknown for a person. */
export async function reconcileStep(o: Pick<Options, 'db' | 'workerId'>, adapter: CampaignAdapter, op: string) {
  const r: any = await o.db.from('campaign_execution_steps').select('operation_id,step,status').eq('operation_id', op).maybeSingle();
  if (r.error || !r.data) throw new Error('Unknown operation');
  const step = r.data.step as ExecutionStep;
  const found = await adapter.reconcile(op, step);
  const finding = step === 'verify_paused' ? 'absent' // read-only step: re-running it has no external effect
    : step === 'build_paused' ? (found.state === 'paused' || found.state === 'active' ? 'applied' : found.state === 'absent' ? 'absent' : 'unknown')
    : found.state === 'active' ? 'applied' : found.state === 'paused' ? 'absent' : 'unknown';
  return rpc(o.db, 'campaign_step_reconcile', { p_operation: op, p_worker: o.workerId, p_finding: finding,
    p_evidence: { state: found.state, evidenceRefs: found.evidenceRefs }, p_platform_ids: found.platformIds ?? null });
}
