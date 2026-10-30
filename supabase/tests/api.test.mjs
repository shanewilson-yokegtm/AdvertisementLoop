// Claude API (src/lib/server/api.ts) against every migration in PGlite: token auth, ownership, uploads, saves,
// processing from Claude, and refusals for someone else's ad. Usage: node supabase/tests/api.test.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { pgClient } from './pgshim.mjs';

const here = import.meta.dirname; const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
function load(file) {
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} }; new Function('require', 'module', 'exports', code)(id => id === './slack' ? load('src/lib/server/slack.ts') : require(id), m, m.exports); return m.exports;
}
const { authenticate, handle, ApiError } = load('src/lib/server/api.ts');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`); };

const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;`);
for (const f of readdirSync(path.join(here, '../migrations')).filter(f => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(path.join(here, '../migrations', f), 'utf8');
  await db.exec(sql.split('-- @supabase-only')[0].replace(/^alter publication.*$/gm, ''));
}
const SHANE = '00000000-0000-0000-0000-00000000000a', TENG = '00000000-0000-0000-0000-00000000000c', HENRY = '00000000-0000-0000-0000-0000000000cc';
await db.exec(`insert into role_grants values ('shane.wilson@yokegtm.com','admin');
  insert into auth.users(id,email) values ('${SHANE}','shane.wilson@yokegtm.com'),('${TENG}','teng.he@yokegtm.com'),('${HENRY}','henry@yokegtm.com');`);
const tokenFor = async uid => {
  const r = await db.exec(`select set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',false); select token from api_token_create('t');`);
  await db.exec(`select set_config('request.jwt.claims','',false)`);
  return r[1].rows[0].token;
};
const T = { teng: await tokenFor(TENG), henry: await tokenFor(HENRY), shane: await tokenFor(SHANE) };
const sdb = pgClient(db);
const APP = 'https://studio.example';
async function call(who, method, route, body, query = '') {
  try {
    const a = await authenticate(sdb, who ? `Bearer ${T[who]}` : null);
    return { status: 200, data: await handle(sdb, a, method, route.split('/').filter(Boolean), body, new URLSearchParams(query), APP) };
  } catch (e) { return e instanceof ApiError ? { status: e.status, code: e.code, message: e.message } : { status: 500, message: String(e) }; }
}

// ---------- auth ----------
ok('no token -> 401', (await call(null, 'GET', 'me')).status === 401);
ok('a token acts as its own member', (await call('teng', 'GET', 'me')).data.email === 'teng.he@yokegtm.com');
ok('bad token -> 401', (await authenticate(sdb, 'Bearer yas_' + '0'.repeat(64)).catch(e => e)).status === 401);

// ---------- create + save real bytes ----------
let r = await call('teng', 'POST', 'assets', { concept_name: 'Follow-ups live in your head', kind: 'static', format: 'feed45', owner_id: HENRY });
const A = r.data.id;
ok('creating an ad makes the caller its owner (owner in body ignored)', r.status === 200 && r.data.owner_id === TENG);
r = await call('teng', 'POST', `assets/${A}/uploads`, { files: [{ name: 'final.png', content_type: 'image/png' }, { name: 'source.svg', content_type: 'image/svg+xml' }] });
ok('owner gets signed upload URLs inside the ad folder', r.status === 200 && r.data.uploads.every(u => u.path.startsWith(A + '/') && u.upload_url.startsWith('https://upload.example/')));
const [png, svg] = r.data.uploads.map(u => u.path);
ok('real file types only (no renaming WebM to MP4)', (await call('teng', 'POST', `assets/${A}/uploads`, { files: [{ name: 'x.mp4', content_type: 'video/x-made-up' }] })).status === 400);
r = await call('teng', 'POST', `assets/${A}/versions`, { file_path: png, content_type: 'image/png', idempotency_key: 'save-1' });
ok('a version cannot be saved before its bytes are uploaded', r.status === 400 && r.code === 'missing_file');
sdb.objects.set(png, { size: 48213, mimetype: 'image/png' }); sdb.objects.set(svg, { size: 2100, mimetype: 'image/svg+xml' });
r = await call('teng', 'POST', `assets/${A}/versions`, { file_path: png, content_type: 'video/mp4', idempotency_key: 'save-1' });
ok('claimed type must match the stored file', r.status === 400 && r.code === 'type_mismatch');
r = await call('teng', 'POST', `assets/${A}/versions`, { file_path: png, content_type: 'image/png', editable_path: svg, width: 1080, height: 1350, copy: { headline: 'Your follow-up strategy is remembering.' }, source: { tool: 'Claude', concept: 'memory' }, idempotency_key: 'save-1' });
ok('owner saves v1 with media, editable source and copy', r.status === 200 && r.data.id === `${A}_v1`, JSON.stringify(r));
const r2 = await call('teng', 'POST', `assets/${A}/versions`, { file_path: png, content_type: 'image/png', idempotency_key: 'save-1' });
ok('retrying the same save returns the same version', r2.data.id === `${A}_v1` && r2.data.duplicate === true && (await db.query(`select count(*)::int n from versions where asset_id='${A}'`)).rows[0].n === 1);
ok('stored size comes from storage, not the client', (await db.query(`select size_bytes from versions where id='${A}_v1'`)).rows[0].size_bytes == 48213);
r = await call('teng', 'POST', `assets/${A}/versions`, { render_state: 'pending', render_note: 'Higgsfield render pending: no credits', idempotency_key: 'video-1' });
ok('a pending render is saved and labelled, not passed off as finished', r.status === 200 && (await db.query(`select render->>'state' s, file_path from versions where id='${A}_v2'`)).rows[0].s === 'pending');

// ---------- fresh Claude conversation can retrieve everything ----------
r = await call('teng', 'GET', `assets/${A}`);
const v1 = r.data.versions.find(v => v.version === 1);
ok('a fresh conversation retrieves media, editable source, copy and links', v1.file_url && v1.editable_url && v1.copy.headline && v1.link === `${APP}/a/${A}?v=${A}_v1` && r.data.you_can_manage === true);

// ---------- another member ----------
r = await call('henry', 'GET', `assets/${A}`);
ok('Henry reads Teng’s ad and its thread', r.status === 200 && r.data.you_can_manage === false && r.data.processing === null);
ok('Henry cannot get upload URLs for Teng’s ad', (await call('henry', 'POST', `assets/${A}/uploads`, { files: [{ name: 'x.png', content_type: 'image/png' }] })).status === 403);
ok('Henry cannot save a version on Teng’s ad', (await call('henry', 'POST', `assets/${A}/versions`, { file_path: png, content_type: 'image/png' })).status === 403);
ok('Henry cannot revert Teng’s ad', (await call('henry', 'POST', `assets/${A}/revert`, { from_version_id: `${A}_v1`, expected_latest_version_id: `${A}_v2` })).status === 403);
ok('Henry cannot start processing Teng’s feedback', (await call('henry', 'POST', `assets/${A}/processing`)).status === 403);
r = await call('henry', 'POST', `assets/${A}/comments`, { version_id: `${A}_v1`, body: 'Shorter headline', author: TENG });
ok('Henry comments, attributed to Henry (author in body ignored)', r.status === 200 && (await db.query(`select author, source from comments where id='${r.data.id}'`)).rows[0].author === HENRY);
await call('shane', 'POST', `assets/${A}/comments`, { version_id: `${A}_v1`, body: 'Use coral CTA' });
const feedbackId = (await db.query(`select id from comments where asset_id=$1 and body='Shorter headline'`, [A])).rows[0].id;
await call('teng', 'POST', `assets/${A}/feedback/${feedbackId}/decide`, { decision: 'approved' });
const feedbackContext = (await call('teng', 'GET', `assets/${A}`)).data.comments.find(c => c.id === feedbackId);
ok('Claude can see the saved feedback decision and decision author', feedbackContext.decision === 'approved' && feedbackContext.decided_by === TENG && feedbackContext.decided_at);
await db.query(`update comments set deleted_at=now(), edited_at=now() where id=$1`, [feedbackId]);
ok('Claude can distinguish deleted feedback from actionable comments', (await call('teng', 'GET', `assets/${A}`)).data.comments.find(c => c.id === feedbackId).deleted_at);
await db.query(`update comments set deleted_at=null where id=$1`, [feedbackId]);
ok('Teng’s inbox shows his ad; Henry’s does not', (await call('teng', 'GET', 'inbox')).data.items[0]?.pending === 2 && (await call('henry', 'GET', 'inbox')).data.items.length === 0);
ok('members cannot open the admin queue', (await call('henry', 'GET', 'inbox', null, 'scope=all')).status === 403);
ok('Shane’s admin queue includes Teng’s ad', (await call('shane', 'GET', 'inbox', null, 'scope=all')).data.items.some(i => i.asset_id === A));

// ---------- process: app <-> Claude, takeover, execute in Claude ----------
let p = (await call('teng', 'POST', `assets/${A}/processing`)).data;
ok('Teng starts processing from Claude', p.status === 'reviewing' && p.started_via === 'claude' && p.comment_ids.length === 2);
const ids = (await db.query(`select id, body from comments where asset_id='${A}' order by created_at`)).rows;
p = (await call('teng', 'POST', `processing/${p.id}/proposal`, { rev: p.rev, proposal: { summary: 'Headline + CTA', items: [{ comment_ids: [ids[0].id], kind: 'compatible', change: 'Cut to 5 words' }] } })).data;
ok('Henry cannot read or change the draft', (await call('henry', 'POST', `processing/${p.id}/proposal`, { rev: p.rev, proposal: {} })).status === 403);
const taken = (await call('shane', 'POST', `assets/${A}/processing`)).data;
ok('Shane takes over the same review without changing the owner', taken.id === p.id && taken.processor === SHANE && (await db.query(`select owner_id from assets where id='${A}'`)).rows[0].owner_id === TENG);
ok('Teng’s stale write after the takeover is refused', (await call('teng', 'POST', `processing/${p.id}/proposal`, { rev: p.rev, proposal: {} })).status === 409);
p = (await call('shane', 'POST', `processing/${p.id}/approve`, { rev: taken.rev, decisions: [{ comment_id: ids[0].id, decision: 'apply' }, { comment_id: ids[1].id, decision: 'defer' }], instructions: 'Apply the shorter headline' })).data;
ok('explicit approval in Claude records the selection, no worker job', p.status === 'approved' && (await db.query(`select count(*)::int n from revision_jobs`)).rows[0].n === 0);
r = await call('shane', 'POST', `assets/${A}/versions`, { parent_version_id: `${A}_v1`, file_path: png, content_type: 'image/png', processing_id: p.id, idempotency_key: 'rev-1' });
ok('a result built on a stale parent is refused', r.status === 409, JSON.stringify(r));
r = await call('shane', 'POST', `assets/${A}/versions`, { parent_version_id: `${A}_v2`, file_path: png, content_type: 'image/png', processing_id: p.id, revision_note: 'Shorter headline', idempotency_key: 'rev-1' });
ok('admin saves the revision on the latest version', r.status === 200 && r.data.id === `${A}_v3`, JSON.stringify(r));
ok('the review was of v2 (latest when it started)', p.reviewed_version_id === `${A}_v2`);
const done = await call('shane', 'POST', `processing/${p.id}/complete`, { rev: p.rev, result_version_id: `${A}_v3` });
ok('admin completes the review with the result', done.status === 200 && done.data.status === 'done', JSON.stringify(done).slice(0, 200));
const st = Object.fromEntries((await db.query(`select body, status, applied_in from comments where asset_id='${A}'`)).rows.map(r => [r.body, r]));
ok('applied feedback resolved into v3; deferred stays pending', st['Shorter headline'].status === 'applied' && st['Shorter headline'].applied_in === `${A}_v3` && st['Use coral CTA'].status === 'open');
ok('ownership unchanged after admin revision; reviser recorded separately', (await db.query(`select owner_id from assets where id='${A}'`)).rows[0].owner_id === TENG && (await db.query(`select created_by from versions where id='${A}_v3'`)).rows[0].created_by === SHANE);
ok('a completed review cannot be completed again', (await call('shane', 'POST', `processing/${p.id}/complete`, { rev: done.data.rev, result_version_id: `${A}_v3` })).status === 400);

// ---------- revert ----------
r = await call('teng', 'POST', `assets/${A}/revert`, { from_version_id: `${A}_v1`, expected_latest_version_id: `${A}_v3` });
ok('owner reverts to v1 as a new v4, history kept', r.status === 200 && r.data.id === `${A}_v4` && r.data.source.reverted_from === `${A}_v1` && !r.data.source.idempotency_key && (await db.query(`select count(*)::int n from versions where asset_id='${A}'`)).rows[0].n === 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
