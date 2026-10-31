// No-network launch rehearsal: real local Postgres (PGlite) with every repository migration, the real executor and
// ledger functions, and an in-memory fake platform. Nothing here reaches a network or an ad account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { pgClient } from '../../supabase/tests/pgshim.mjs';

const root = path.resolve(import.meta.dirname, '../..'); const require = createRequire(import.meta.url); const cache = new Map();
function load(file) {
  file = path.resolve(root, file); if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    if (!id.startsWith('.')) return require(id);
    const resolved = path.resolve(path.dirname(file), id);
    for (const c of [resolved + '.ts', resolved + '.tsx', resolved + '.js']) if (existsSync(c)) return load(c);
    return require(resolved);
  }, module, module.exports); return module.exports;
}
const { handleCampaign } = load('src/lib/server/campaign-api.ts');
const { executeLaunch, reconcileStep, operationId } = load('src/lib/server/campaign-executor.ts');
const { DefiniteFailure, registeredAdapters } = load('src/lib/campaigns/adapters.ts');
const { digest } = load('src/lib/campaigns/playbook.ts');
const fixture = JSON.parse(readFileSync(path.join(import.meta.dirname, 'brief.fixture.json')));
const CREATOR = '00000000-0000-0000-0000-000000000001', ADMIN = '00000000-0000-0000-0000-000000000003';
const creator = { user_id: CREATOR, role: 'creator', email: 'one@yokegtm.com', display_name: 'One' };
const admin = { ...creator, user_id: ADMIN, role: 'admin', email: 'admin@yokegtm.com' };

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    grant usage on schema auth,public to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const f of readdirSync(path.join(root, 'supabase/migrations')).filter(x => x.endsWith('.sql')).sort())
    await db.exec(readFileSync(path.join(root, 'supabase/migrations', f), 'utf8').split('-- @supabase-only')[0].replace(/^alter publication.*$/gm, ''));
  await db.exec(`insert into role_grants values('admin@yokegtm.com','admin');
    insert into auth.users(id,email) values('${CREATOR}','one@yokegtm.com'),('${ADMIN}','admin@yokegtm.com');
    insert into assets(id,concept_name,kind,format,created_by,owner_id) values('fixture-asset','Fixture','static','square','${CREATOR}','${CREATOR}');
    insert into versions(id,asset_id,version,file_path,width,height,render,created_by) values('fixture-asset_v1','fixture-asset',1,'fixture.png',1080,1080,'{"state":"ready"}','${CREATOR}');
    insert into reviews(version_id,status,reviewer) values('fixture-asset_v1','approved','${ADMIN}');`);
  const client = pgClient(db); const q = new URLSearchParams();
  const api = (a, m, p, b) => handleCampaign(client, a, m, p, b, q);
  const authorized = async key => {
    const { state } = await api(creator, 'POST', [], { title: 'Rehearsal ' + key, requestKey: 'create-' + key });
    const send = (a, rev, k, command) => api(a, 'POST', [state.id, 'commands'], { expectedRevision: rev, requestKey: k + '-' + key, command });
    const saved = await send(creator, 1, 'brief', { type: 'save_brief', brief: fixture });
    await send(admin, 2, 'approve', { type: 'approve', fingerprint: saved.fingerprint });
    const auth = await send(admin, 3, 'authorize', { type: 'authorize_launch', fingerprint: saved.fingerprint, personConfirmed: true });
    return { id: state.id, launch: auth.state.launch, fingerprint: saved.fingerprint, send };
  };
  const steps = async id => (await db.query(`select step,status,attempt from campaign_execution_steps where campaign_id='${id}' order by claimed_at,step`)).rows;
  return { db, client, api, authorized, steps };
}

/** In-memory platform keyed by operation id. `fault` hooks let a test inject crashes, hangs and rejections. */
function fakePlatform(fault = {}) {
  const ops = new Map(); const calls = { build: 0, verify: 0, activate: 0, reconcile: 0 };
  const adapter = {
    channel: 'meta',
    async preflight() { return { ready: true, evidenceRefs: [], blockers: [] }; },
    async buildPaused(plan, op) {
      calls.build++; if (fault.build) return fault.build(op, ops);
      ops.set(op, { state: 'paused', ids: { campaign: 'c-' + op.slice(3, 9) } });
      return { platformIds: ops.get(op).ids, receiptRef: 'build:' + op };
    },
    async verifyPaused(ids, plan) {
      calls.verify++; if (fault.verify) return fault.verify(ids);
      return { matches: true, previewRefs: ['preview:' + ids.campaign], differences: [] };
    },
    async activate(ids, authId, op) {
      calls.activate++; if (fault.activate) return fault.activate(op, ops);
      ops.set(op, { state: 'active' }); return { state: 'active', receiptRef: 'activate:' + op };
    },
    // Activation is looked up on the built campaign: with no activation recorded it is still paused.
    async reconcile(op, step) {
      calls.reconcile++; const o = ops.get(op);
      const built = [...ops.values()].some(v => v.ids);
      return { state: o?.state ?? (step === 'activate' && built ? 'paused' : 'absent'), evidenceRefs: ['lookup:' + op], platformIds: o?.ids };
    },
    async observe() { throw new Error('not used'); },
  };
  return { adapter, ops, calls };
}
const run = (env, id, platform, extra = {}) => executeLaunch({ db: env.client, campaignId: id, workerId: extra.workerId || 'worker-a', adapters: { meta: platform.adapter }, leaseSeconds: 60, stepTimeoutMs: 200, ...extra });

test('production wiring stays disconnected: no registered adapters and attempt_launch still blocks', async () => {
  const env = await setup();
  assert.deepEqual(Object.keys(registeredAdapters), []);
  const c = await env.authorized('prod');
  const [out] = await executeLaunch({ db: env.client, campaignId: c.id, workerId: 'w', adapters: registeredAdapters });
  assert.equal(out.status, 'blocked'); assert.match(out.detail, /not connected/);
  assert.equal((await c.send(creator, 4, 'attempt', { type: 'attempt_launch' })).state.status, 'launch_blocked');
  assert.deepEqual(await env.steps(c.id), []);
  await env.db.close();
});

test('happy path builds paused, verifies, activates once; repeated commands reuse receipts', async () => {
  const env = await setup(); const c = await env.authorized('happy'); const p = fakePlatform();
  const [first] = await run(env, c.id, p);
  assert.equal(first.status, 'active');
  assert.deepEqual(await env.steps(c.id), [
    { step: 'build_paused', status: 'succeeded', attempt: 1 }, { step: 'verify_paused', status: 'succeeded', attempt: 1 }, { step: 'activate', status: 'succeeded', attempt: 1 }]);
  const [again] = await run(env, c.id, p, { workerId: 'worker-b' });
  assert.equal(again.status, 'active');
  assert.deepEqual(p.calls, { build: 1, verify: 1, activate: 1, reconcile: 6 }); // reconcile = read-only before-state only
  const row = (await env.db.query(`select before_state,payload_hash,receipt from campaign_execution_steps where operation_id='${operationId(c.launch.id, 'meta', 'activate')}'`)).rows[0];
  assert.equal(row.before_state.state, 'paused'); assert.match(row.payload_hash, /^[a-f0-9]{64}$/); assert.equal(row.receipt.state, 'active');
  assert.equal((await env.db.query(`select count(*)::int n from campaign_execution_log where campaign_id='${c.id}'`)).rows[0].n, 6);
  await env.db.close();
});

test('concurrent workers never duplicate a step', async () => {
  const env = await setup(); const c = await env.authorized('race');
  let release; const gate = new Promise(r => { release = r; });
  const p = fakePlatform({ build: async (op, ops) => { await gate; ops.set(op, { state: 'paused', ids: { campaign: 'c1' } }); return { platformIds: { campaign: 'c1' }, receiptRef: 'b' }; } });
  const a = run(env, c.id, p, { workerId: 'worker-a', stepTimeoutMs: 5000 });
  await new Promise(r => setTimeout(r, 50));
  const [b] = await run(env, c.id, p, { workerId: 'worker-b' });
  assert.equal(b.status, 'in_progress');
  release(); assert.equal((await a)[0].status, 'active');
  assert.equal(p.calls.build, 1); assert.equal(p.calls.activate, 1);
  // Direct simultaneous claims on a fresh operation: exactly one wins.
  const c2 = await env.authorized('race2');
  const claim = w => env.client.rpc('campaign_step_claim', { p_operation: operationId(c2.launch.id, 'meta', 'build_paused'), p_campaign: c2.id, p_launch: c2.launch.id,
    p_channel: 'meta', p_step: 'build_paused', p_fingerprint: c2.fingerprint, p_payload_hash: 'h', p_before: { state: 'absent' }, p_worker: w, p_lease_seconds: 60 });
  const results = await Promise.all([claim('w1'), claim('w2'), claim('w3')]);
  assert.equal(results.filter(r => r.data?.claimed).length, 1);
  assert.equal((await env.db.query(`select count(*)::int n from campaign_execution_steps where campaign_id='${c2.id}'`)).rows[0].n, 1);
  // Same operation with a different intended payload is refused, not overwritten.
  const changed = await env.client.rpc('campaign_step_claim', { p_operation: operationId(c2.launch.id, 'meta', 'build_paused'), p_campaign: c2.id, p_launch: c2.launch.id,
    p_channel: 'meta', p_step: 'build_paused', p_fingerprint: c2.fingerprint, p_payload_hash: 'other', p_before: {}, p_worker: 'w4', p_lease_seconds: 60 });
  assert.match(changed.error.message, /different payload/);
  await env.db.close();
});

test('a crash after a possible effect becomes unknown and is reconciled, never blindly retried', async () => {
  const env = await setup(); const c = await env.authorized('crash');
  let crash = true;
  const p = fakePlatform({ build: async (op, ops) => {
    ops.set(op, { state: 'paused', ids: { campaign: 'c-crash' } }); // the platform applied it...
    if (crash) throw new Error('socket hang up');                  // ...but the response was lost
    return { platformIds: { campaign: 'c-crash' }, receiptRef: 'b' };
  } });
  assert.equal((await run(env, c.id, p))[0].status, 'needs_reconciliation');
  crash = false;
  assert.equal((await run(env, c.id, p))[0].status, 'needs_reconciliation'); // still refuses without reconciliation
  assert.equal(p.calls.build, 1);
  const op = operationId(c.launch.id, 'meta', 'build_paused');
  const rec = await reconcileStep({ db: env.client, workerId: 'reconciler' }, p.adapter, op);
  assert.equal(rec.status, 'succeeded'); assert.deepEqual(rec.platform_ids, { campaign: 'c-crash' });
  assert.equal((await run(env, c.id, p))[0].status, 'active');
  assert.equal(p.calls.build, 1); // the build was never repeated

  // A worker that died mid-claim (lease expired): becomes unknown; proven absent; then a second attempt runs.
  const c2 = await env.authorized('lease'); const p2 = fakePlatform(); const op2 = operationId(c2.launch.id, 'meta', 'build_paused');
  const plan = (await env.api(creator, 'GET', [c2.id])).deploymentPlan[0];
  await env.client.rpc('campaign_step_claim', { p_operation: op2, p_campaign: c2.id, p_launch: c2.launch.id, p_channel: 'meta', p_step: 'build_paused',
    p_fingerprint: c2.fingerprint, p_payload_hash: digest({ fingerprint: c2.fingerprint, channel: 'meta', step: 'build_paused', payload: plan }), p_before: { state: 'absent' }, p_worker: 'dead', p_lease_seconds: 60 });
  await env.db.exec(`update campaign_execution_steps set lease_expires_at = now() - interval '1 second' where operation_id='${op2}'`);
  assert.equal((await run(env, c2.id, p2))[0].status, 'needs_reconciliation');
  assert.equal((await env.steps(c2.id))[0].status, 'unknown'); assert.equal(p2.calls.build, 0);
  assert.equal((await reconcileStep({ db: env.client, workerId: 'r' }, p2.adapter, op2)).status, 'absent');
  assert.equal((await run(env, c2.id, p2))[0].status, 'active');
  assert.equal((await env.steps(c2.id))[0].attempt, 2);
  await env.db.close();
});

test('timeouts, partial activation and definite rejections are recorded as such', async () => {
  const env = await setup();
  const c = await env.authorized('hang');
  const hang = fakePlatform({ activate: () => new Promise(() => {}) });
  const [h] = await run(env, c.id, hang, { stepTimeoutMs: 30 });
  assert.equal(h.status, 'needs_reconciliation'); assert.equal(h.step, 'activate'); assert.match(h.detail, /timed out/);
  assert.equal((await reconcileStep({ db: env.client, workerId: 'r' }, hang.adapter, h.operationId)).status, 'absent'); // platform still paused
  const c2 = await env.authorized('partial');
  const partial = fakePlatform({ activate: async (op, ops) => { ops.set(op, { state: 'partial' }); return { state: 'partial', receiptRef: 'p' }; } });
  const [pt] = await run(env, c2.id, partial);
  assert.equal(pt.status, 'needs_reconciliation');
  assert.equal((await reconcileStep({ db: env.client, workerId: 'r' }, partial.adapter, pt.operationId)).status, 'unknown'); // ambiguous stays with a person
  assert.equal((await run(env, c2.id, partial))[0].status, 'needs_reconciliation'); assert.equal(partial.calls.activate, 1);
  const c3 = await env.authorized('reject');
  const reject = fakePlatform({ build: async () => { throw new DefiniteFailure('Invalid targeting', { code: 100 }); } });
  const [rj] = await run(env, c3.id, reject);
  assert.equal(rj.status, 'failed'); assert.equal((await env.steps(c3.id))[0].status, 'failed');
  assert.equal((await run(env, c3.id, reject))[0].status, 'failed'); assert.equal(reject.calls.build, 1);
  await env.db.close();
});

test('stale authorization, changed plans, unready assets and mismatched readback stop activation', async () => {
  const env = await setup();
  // Expired authorization: nothing is claimed or called.
  const c = await env.authorized('expired'); const p = fakePlatform();
  const [ex] = await run(env, c.id, p, { now: () => new Date(Date.parse(c.launch.expiresAt) + 1000) });
  assert.equal(ex.status, 'blocked'); assert.match(ex.detail, /expired/); assert.equal(p.calls.build, 0); assert.deepEqual(await env.steps(c.id), []);
  // Plan changed after the paused build: activation is refused by the worker and by the database.
  const c2 = await env.authorized('changed');
  const p2 = fakePlatform({ activate: async () => { throw new Error('should not activate'); } });
  await env.db.exec(`update reviews set status='changes' where version_id='fixture-asset_v1'`); // asset no longer approved
  assert.match((await run(env, c2.id, p2))[0].detail, /approved, ready/); assert.equal(p2.calls.build, 0);
  await env.db.exec(`update reviews set status='approved' where version_id='fixture-asset_v1'`);
  const p3 = fakePlatform({ verify: async () => ({ matches: false, previewRefs: [], differences: ['budget 120 != 100'] }) });
  const [mm] = await run(env, c2.id, p3);
  assert.equal(mm.status, 'blocked'); assert.match(mm.detail, /budget/); assert.equal(p3.calls.activate, 0);
  const forced = await env.client.rpc('campaign_step_claim', { p_operation: operationId(c2.launch.id, 'meta', 'activate'), p_campaign: c2.id, p_launch: c2.launch.id,
    p_channel: 'meta', p_step: 'activate', p_fingerprint: c2.fingerprint, p_payload_hash: 'x', p_before: {}, p_worker: 'w', p_lease_seconds: 60 });
  assert.match(forced.error.message, /did not match/);
  await c2.send(creator, 4, 'rebrief', { type: 'save_brief', brief: { ...fixture, offer: 'Changed offer' } });
  const [ch] = await run(env, c2.id, fakePlatform());
  assert.equal(ch.status, 'blocked'); assert.match(ch.detail, /Stale authorization/);
  const old = await env.client.rpc('campaign_step_claim', { p_operation: operationId(c2.launch.id, 'meta', 'activate'), p_campaign: c2.id, p_launch: c2.launch.id,
    p_channel: 'meta', p_step: 'activate', p_fingerprint: c2.fingerprint, p_payload_hash: 'x', p_before: {}, p_worker: 'w', p_lease_seconds: 60 });
  assert.match(old.error.message, /stale authorization/);
  assert.equal((await env.db.query(`select count(*)::int n from campaign_execution_steps where step='activate'`)).rows[0].n, 0);
  await env.db.close();
});

test('ledger is server-only and its history cannot be erased', async () => {
  const env = await setup(); const c = await env.authorized('perm'); await run(env, c.id, fakePlatform());
  await assert.rejects(env.db.exec(`delete from campaign_execution_steps`), /append-only/);
  await assert.rejects(env.db.exec(`update campaign_execution_log set to_status='forged'`), /append-only/);
  await env.db.exec(`select set_config('request.jwt.claims','{"sub":"${ADMIN}","role":"authenticated"}',false); set role authenticated;`);
  assert.equal((await env.db.query('select operation_id from campaign_execution_steps')).rows.length, 3);
  await assert.rejects(env.db.query(`select campaign_step_reconcile('x','w','applied','{}')`), /permission denied/);
  await assert.rejects(env.db.exec(`update campaign_execution_steps set status='succeeded'`), /permission denied/);
  await env.db.exec('reset role;');
  await env.db.close();
});
