// Server-only launch executor over the durable step ledger (migration 20261031001000_campaign_execution_ledger).
// Not routed to any API, tool or schedule. `attempt_launch` stays blocked and `registeredAdapters` is empty, so in
// production this module cannot reach a platform. Tests drive it with a fake adapter against local Postgres.
//
// Rules: claim and persist each step (operation id, payload hash, before-state incl. preflight) before calling out;
// a call that times out or errors without a definite rejection is recorded as `unknown` and is released for retry
// only on authoritative no-effect evidence; recheck the exact approved plan, authorization expiry, asset readiness
// and account preflight before the build and again before activation; under the exclusive activation claim, read
// the paused build back fresh and block on any drift. The database fences plan/authorization changes while a step
// is unresolved or the campaign is live.
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

/** Account/identity/tracking readiness from the adapter. Requires readiness and at least one evidence reference. */
async function preflightCheck(o: Options, adapter: CampaignAdapter, plan: ChannelPlan, at: string) {
  let r: Awaited<ReturnType<CampaignAdapter['preflight']>>;
  try { r = await withTimeout(adapter.preflight(plan), o.stepTimeoutMs ?? 30_000); }
  catch (e: any) { throw new Stop({ status: 'blocked', detail: `Preflight ${at} failed: ${e.message}` }); }
  if (!r.ready || !r.evidenceRefs.length)
    throw new Stop({ status: 'blocked', detail: `Preflight ${at} not ready: ${r.blockers.join('; ') || 'no account evidence returned'}` });
  return { at, ready: r.ready, evidenceRefs: r.evidenceRefs, blockers: r.blockers };
}

type BeforeCall = () => Promise<{ proceed: boolean; evidence: Record<string, unknown>; detail?: string }>;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(t));
}

async function runStep(o: Options, adapter: CampaignAdapter, state: CampaignState, channel: Channel, step: ExecutionStep, payload: unknown,
  call: (op: string) => Promise<{ outcome: 'succeeded' | 'unknown'; receipt: Record<string, unknown>; platformIds?: Record<string, string> }>,
  extras: { preflight?: unknown; beforeCall?: BeforeCall } = {}): Promise<StepRow> {
  const launch = state.launch!; const op = operationId(launch.id, channel, step);
  // Read-only evidence of the platform state (and account preflight) before this step.
  const before = { platform: await adapter.reconcile(op, step), preflight: extras.preflight ?? null };
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
    if (s.status === 'blocked') throw new Stop({ status: 'blocked', step, operationId: op, detail: `Stopped before the external call: ${s.receipt?.reason ?? 'see ledger'}` });
    throw new Stop({ status: 'needs_reconciliation', step, operationId: op, detail: 'Outcome unknown; reconcile against the platform before any retry' });
  }
  const attempt = claim.step.attempt;
  if (extras.beforeCall) {
    // Runs under this worker's exclusive claim, after every other check and immediately before the external call.
    let check: Awaited<ReturnType<BeforeCall>>;
    try { check = await withTimeout(extras.beforeCall(), o.stepTimeoutMs ?? 30_000); }
    catch (e: any) { check = { proceed: false, evidence: { error: String(e.message).slice(0, 500) }, detail: `check failed: ${e.message}` }; }
    try { await rpc(o.db, 'campaign_step_evidence', { p_operation: op, p_worker: o.workerId, p_attempt: attempt, p_evidence: check.evidence }); }
    catch (e: any) {
      // The database refused the pre-call gate (authorization changed/expired or claim lost). No call was made:
      // record the step as blocked if we still hold it; otherwise leave it for reconciliation.
      const reason = `Pre-call gate refused (no external call was made): ${e.message}`;
      try { await rpc(o.db, 'campaign_step_complete', { p_operation: op, p_worker: o.workerId, p_attempt: attempt, p_outcome: 'blocked', p_receipt: { reason, ...check.evidence } }); }
      catch { throw new Stop({ status: 'needs_reconciliation', step, operationId: op, detail: reason }); }
      throw new Stop({ status: 'blocked', step, operationId: op, detail: reason });
    }
    if (!check.proceed) {
      const reason = check.detail || 'pre-call check failed';
      try { await rpc(o.db, 'campaign_step_complete', { p_operation: op, p_worker: o.workerId, p_attempt: attempt, p_outcome: 'blocked', p_receipt: { reason, ...check.evidence } }); }
      catch (e: any) { throw new Stop({ status: 'needs_reconciliation', step, operationId: op, detail: `Could not record the block (no external call was made): ${e.message}` }); }
      throw new Stop({ status: 'blocked', step, operationId: op, detail: reason });
    }
  }
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
    const preBuild = await preflightCheck(o, adapter, plan, 'before build');
    const built = await runStep(o, adapter, state, channel, 'build_paused', plan, async op => {
      const r = await adapter.buildPaused(plan, op);
      return { outcome: 'succeeded', receipt: { receiptRef: r.receiptRef }, platformIds: r.platformIds };
    }, { preflight: preBuild });
    const ids = built.platform_ids || {};
    ({ state, plan } = await guard(o, channel, launchId));
    const verified = await runStep(o, adapter, state, channel, 'verify_paused', { ids, plan }, async () => {
      const r = await adapter.verifyPaused(ids, plan);
      return { outcome: 'succeeded', receipt: { matches: r.matches, previewRefs: r.previewRefs, differences: r.differences } };
    });
    if (!verified.receipt?.matches) return { channel, status: 'blocked', step: 'verify_paused', detail: `Paused build differs from the approved plan: ${(verified.receipt?.differences || []).join('; ')}` };
    ({ state, plan } = await guard(o, channel, launchId)); // final exact-plan, expiry and asset recheck before spend
    const preActivate = await preflightCheck(o, adapter, plan, 'before activation');
    const activePlan = plan;
    await runStep(o, adapter, state, channel, 'activate', { ids, authorizationId: launchId }, async op => {
      const r = await adapter.activate(ids, launchId, op);
      return { outcome: r.state === 'active' ? 'succeeded' : 'unknown', receipt: { state: r.state, receiptRef: r.receiptRef } };
    }, { preflight: preActivate, beforeCall: async () => {
      // The earlier readback can be stale: someone may have edited the paused entity since. Read it again now.
      const r = await adapter.verifyPaused(ids, activePlan);
      if (!r.matches) return { proceed: false, evidence: { preActivationReadback: r }, detail: `Paused build drifted from the approved plan: ${r.differences.join('; ')}` };
      // The readback can be slow: recheck authorization, expiry, spending window and assets after it, right
      // before the gate is recorded. The database repeats the authorization check when recording it.
      try { await guard(o, channel, launchId); }
      catch (e: any) { return { proceed: false, evidence: { preActivationReadback: r, recheck: String(e.message) }, detail: e.message }; }
      return { proceed: true, evidence: { preActivationReadback: r, recheckedAt: (o.now ?? (() => new Date()))().toISOString() } };
    } });
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

/** Resolve an `unknown` step from read-only platform evidence. A step is released for retry (`absent`) only on
 * authoritative terminal no-effect evidence or documented provider idempotency; otherwise it stays unknown. */
export async function reconcileStep(o: Pick<Options, 'db' | 'workerId'>, adapter: CampaignAdapter, op: string) {
  const r: any = await o.db.from('campaign_execution_steps').select('operation_id,step,status,channel').eq('operation_id', op).maybeSingle();
  if (r.error || !r.data) throw new Error('Unknown operation');
  if (adapter.channel !== r.data.channel) throw new Error(`Adapter for ${adapter.channel} cannot reconcile a ${r.data.channel} step`);
  const step = r.data.step as ExecutionStep;
  if (step === 'verify_paused') // read-only step: re-running it has no external effect
    return rpc(o.db, 'campaign_step_reconcile', { p_operation: op, p_worker: o.workerId, p_finding: 'absent', p_evidence: { basis: 'read_only' } });
  const found = await adapter.reconcile(op, step);
  const applied = step === 'build_paused' ? (found.state === 'paused' || found.state === 'active') : found.state === 'active';
  const noEffectSeen = step === 'build_paused' ? found.state === 'absent' : found.state === 'paused';
  const idempotency = adapter.providerIdempotency?.[step];
  const [finding, basis] = applied ? ['applied', 'observed']
    : noEffectSeen && found.terminalNoEffect ? ['absent', 'terminal_no_effect']
    : noEffectSeen && idempotency ? ['absent', 'provider_idempotency']
    : ['unknown', noEffectSeen ? 'not_found_may_still_apply' : 'ambiguous'];
  return rpc(o.db, 'campaign_step_reconcile', { p_operation: op, p_worker: o.workerId, p_finding: finding,
    p_evidence: { basis, state: found.state, evidenceRefs: found.evidenceRefs, terminalNoEffect: !!found.terminalNoEffect, ...(finding === 'absent' && basis === 'provider_idempotency' ? { idempotencyRef: idempotency } : {}) },
    p_platform_ids: found.platformIds ?? null });
}
