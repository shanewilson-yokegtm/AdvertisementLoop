import * as z from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, dbError, type Actor } from './api';
import { assertAssetsReady } from './campaign-assets';
import { PLAYBOOK_VERSION, commandSchema, type CampaignState } from '../campaigns/contracts';
import { applyCommand, CampaignError, requireRole } from '../campaigns/workflow';
import { auditPlan, report, closeout, type StoredBatch } from '../campaigns/reporting';
import { playbook, capabilities, digest, deploymentPlan, memoMarkdown, planFingerprint } from '../campaigns/playbook';

const idSchema = z.string().regex(/^yc_[a-f0-9]{24}$/);
const envelope = z.object({ expectedRevision: z.number().int().nonnegative(), requestKey: z.string().min(8).max(120), command: commandSchema }).strict();
const unwrap = <T>(r: { data: T; error: any }): T => { if (r.error) throw dbError(r.error); return r.data; };
const enrich = (s: CampaignState) => ({ state: s, fingerprint: planFingerprint(s), memo: s.brief ? memoMarkdown(s.brief) : null, deploymentPlan: deploymentPlan(s), capabilities: capabilities() });
export async function handleCampaign(db: SupabaseClient, actor: Actor, method: string, path: string[], body: unknown, query: URLSearchParams) {
  try { return await route(db, actor, method, path, body, query); }
  catch (e) {
    if (e instanceof CampaignError) throw new ApiError(e.status, e.code, e.message);
    if (e instanceof z.ZodError) throw new ApiError(400, 'invalid', e.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    throw e;
  }
}
async function route(db: SupabaseClient, actor: Actor, method: string, path: string[], body: unknown, query: URLSearchParams): Promise<unknown> {
  if (!['viewer','creator','approver','admin'].includes(actor.role)) throw new ApiError(403, 'forbidden', 'Yoke membership required');
  const [id, action] = path;
  if (id === 'playbook' && method === 'GET') return { playbook, capabilities: capabilities() };
  if (id === 'due' && method === 'GET') {
    const rows = unwrap(await db.from('campaign_records').select('state').order('updated_at', { ascending: true }).limit(501)) || [];
    if (rows.length > 500) throw new ApiError(422,'pagination_required','Due scan exceeds 500 campaigns; implement cursor-based scheduling before enabling the worker');
    return { scheduled: false, items: rows.map((r: any) => r.state as CampaignState).filter(s => s.status !== 'closed' && s.brief && Date.parse(s.brief.analyzeAfter) <= Date.now()).map(s => ({ id: s.id, revision: s.revision, title: s.title, analyzeAfter: s.brief!.analyzeAfter })) };
  }
  if (!id && method === 'GET') {
    const rows = unwrap(await db.from('campaign_records').select('id,owner_id,revision,state,updated_at').order('updated_at', { ascending: false }).limit(101)) || [];
    return { items: rows.slice(0,100), hasMore: rows.length > 100 };
  }
  if (!id && method === 'POST') {
    requireRole(actor, 'creator');
    const input = z.object({ title: z.string().trim().min(1).max(150), requestKey: z.string().min(8).max(120) }).strict().parse(body);
    // Stable create identity makes a lost create response safe to retry for this actor and key.
    const newId = `yc_${digest({ actor: actor.user_id, key: input.requestKey }).slice(0,24)}`;
    const state: CampaignState = { schemaVersion: 1, id: newId, title: input.title, ownerId: actor.user_id, revision: 1, status: 'draft', playbookVersion: PLAYBOOK_VERSION, planningNotes: '', brief: null, approval: null, launch: null };
    const result: any = unwrap(await db.rpc('campaign_commit', { p_campaign: newId, p_expected: 0, p_actor: actor.user_id, p_kind: 'create', p_key: input.requestKey, p_hash: digest(input), p_state: state }));
    return { ...enrich(result.state), repeated: result.repeated };
  }
  idSchema.parse(id);
  const record: any = unwrap(await db.from('campaign_records').select('state').eq('id', id).maybeSingle());
  if (!record) throw new ApiError(404, 'not_found', 'Campaign not found');
  const state = record.state as CampaignState;
  if (method === 'GET' && !action) return enrich(state);
  if (method === 'GET' && (action === 'events' || action === 'observations')) {
    const table = action === 'events' ? 'campaign_events' : 'campaign_observations';
    const rows = unwrap(await db.from(table).select('*').eq('campaign_id', id).order('created_at', { ascending: false }).limit(101)) || [];
    return { items: rows.slice(0,100), hasMore: rows.length > 100 };
  }
  if (method === 'GET' && (action === 'report' || action === 'closeout')) {
    const batches = unwrap(await db.from('campaign_metric_batches').select('*').eq('campaign_id', id).order('created_at', { ascending: true }).limit(501)) as StoredBatch[];
    if (batches.length > 500) throw new ApiError(422,'pagination_required','Reporting exceeds 500 batches; query paginated facts before computing totals');
    const groupBy = z.enum(['concept','channel','audience','version']).parse(query.get('groupBy') || 'concept');
    const from = query.get('from') || undefined, to = query.get('to') || undefined;
    for (const value of [from,to]) if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400,'invalid','Use YYYY-MM-DD dates');
    if (from && to && from > to) throw new ApiError(400,'invalid','Start must precede end');
    return action === 'closeout' ? closeout(state,batches) : report(state,batches,groupBy,from,to);
  }
  if (method === 'POST' && action === 'commands') {
    const input = envelope.parse(body);
    const hash = digest({ actor: actor.user_id, command: input.command });
    const prior: any = unwrap(await db.from('campaign_events').select('request_hash,actor_id,result').eq('campaign_id',id).eq('request_key',input.requestKey).maybeSingle());
    if (prior) {
      if (prior.request_hash !== hash || prior.actor_id !== actor.user_id) throw new ApiError(409,'conflict','Request key already used for another command');
      return { ...enrich(prior.result), repeated: true };
    }
    if (input.expectedRevision !== state.revision) throw new ApiError(409,'conflict','Campaign changed; reload before saving');
    if (input.command.type === 'approve' || input.command.type === 'authorize_launch') {
      await assertAssetsReady(db, state);
    }
    const next = applyCommand(state, input.command, actor);
    const cmd = input.command;
    const result: any = unwrap(await db.rpc('campaign_commit', {
      p_campaign: id, p_expected: input.expectedRevision, p_actor: actor.user_id, p_kind: cmd.type,
      p_key: input.requestKey, p_hash: hash, p_state: next,
      p_note: cmd.type === 'close' ? cmd.note : null,
      p_observation: cmd.type === 'observe' ? cmd.observation : null,
      p_audit: cmd.type === 'observe' ? auditPlan(state, cmd.observation) : null,
      p_metrics: cmd.type === 'import_metrics' ? cmd.batch : null,
    }));
    return { ...enrich(result.state), repeated: result.repeated };
  }
  throw new ApiError(404, 'not_found', 'Unknown campaign action');
}
