// Ownership, permissions and feedback processing, run against every migration in PGlite.
// Two members (Teng, Henry) and an admin (Shane). Usage: node supabase/tests/ownership.test.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '../migrations');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`); };
const first = e => String(e?.message || e).split('\n')[0];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`);
// Storage/realtime-only migrations need Supabase services that PGlite doesn't have.
for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(path.join(dir, f), 'utf8');
  await db.exec(sql.split('-- @supabase-only')[0].replace(/^alter publication.*$/gm, ''));
}
ok('all migrations apply', true);

const SHANE = '00000000-0000-0000-0000-00000000000a', TENG = '00000000-0000-0000-0000-00000000000c', HENRY = '00000000-0000-0000-0000-0000000000cc';
await db.exec(`insert into role_grants values ('shane.wilson@yokegtm.com','admin')`);
await db.exec(`insert into auth.users(id,email) values ('${SHANE}','shane.wilson@yokegtm.com'),('${TENG}','teng.he@yokegtm.com'),('${HENRY}','henry@yokegtm.com')`);

async function as(uid, sql) {
  const claims = uid === 'server' ? JSON.stringify({ role: 'service_role' }) : JSON.stringify({ sub: uid, role: 'authenticated' });
  const role = uid === 'server' ? 'service_role' : 'authenticated';
  try { const r = await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${claims}', false); ${sql};`); return r[r.length - 1]; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claims','',false);`); }
}
const q = async (uid, sql) => (await as(uid, sql)).rows;
const allowed = async (name, uid, sql) => { try { await as(uid, sql); ok(name, true); } catch (e) { ok(name, false, first(e)); } };
const denied = async (name, uid, sql, match) => { try { await as(uid, sql); ok(name, false, 'was allowed'); } catch (e) { ok(name, !match || match.test(first(e)), first(e)); } };
const val = async (sql) => (await db.query(sql)).rows;

// ---------- ownership ----------
await allowed('Teng creates an ad', TENG, `insert into assets(id,concept_name,kind,format,owner_id) values ('ast_teng','Teng ad','static','feed45','${HENRY}')`);
await allowed('Henry creates an ad', HENRY, `insert into assets(id,concept_name,kind,format) values ('ast_henry','Henry ad','motion','vertical')`);
ok('owner is the signed-in creator (forged owner ignored)', (await val(`select owner_id from assets where id='ast_teng'`))[0].owner_id === TENG);
await allowed('Teng adds v1 to own ad', TENG, `insert into versions(id,asset_id,version,file_path,content_type) values ('x','ast_teng',0,'ast_teng/v1.png','image/png')`);
await allowed('Henry adds v1 to own ad', HENRY, `insert into versions(id,asset_id,version,file_path,content_type) values ('x','ast_henry',0,'ast_henry/v1.mp4','video/mp4')`);

// ---------- shared reading, attributed comments ----------
ok('Henry sees Teng’s ad', (await q(HENRY, `select count(*)::int n from assets where id='ast_teng'`))[0].n === 1);
await allowed('Henry comments on Teng’s ad', HENRY, `insert into comments(asset_id,version_id,body,author) values ('ast_teng','ast_teng_v1','Shorter headline','${SHANE}')`);
await allowed('Shane comments on Teng’s ad', SHANE, `insert into comments(asset_id,version_id,body) values ('ast_teng','ast_teng_v1','Use the coral CTA')`);
await allowed('Teng comments on own ad', TENG, `insert into comments(asset_id,version_id,body) values ('ast_teng','ast_teng_v1','Note to self: bigger logo')`);
ok('author cannot be spoofed', (await val(`select author from comments where body='Shorter headline'`))[0].author === HENRY);
ok('Henry reads the full thread on Teng’s ad', (await q(HENRY, `select count(*)::int n from comments where asset_id='ast_teng'`))[0].n === 3);
await denied('comment must belong to the version’s asset', HENRY, `insert into comments(asset_id,version_id,body) values ('ast_teng','ast_henry_v1','wrong')`);

// ---------- what a non-owner cannot do ----------
await denied('Henry cannot add a version to Teng’s ad', HENRY, `insert into versions(id,asset_id,version,file_path) values ('x','ast_teng',0,'ast_teng/evil.png')`);
await as(HENRY, `update assets set concept_name='hijacked', archived=true where id='ast_teng'`).catch(() => {});
ok('Henry cannot rename or reject Teng’s ad', (await val(`select concept_name, archived from assets where id='ast_teng'`))[0].concept_name === 'Teng ad');
await as(HENRY, `update comments set status='dismissed' where asset_id='ast_teng'`).catch(() => {});
ok('Henry cannot resolve feedback on Teng’s ad', (await val(`select count(*)::int n from comments where asset_id='ast_teng' and status='open'`))[0].n === 3);
await denied('Henry cannot start processing Teng’s feedback', HENRY, `select processing_start('ast_teng','app')`, /owner or an admin/);
await denied('Henry cannot revert Teng’s ad', HENRY, `select revert_asset('ast_teng','ast_teng_v1','ast_teng_v1')`, /owner or an admin/);
await denied('Henry cannot act as Teng through p_actor', HENRY, `select processing_start('ast_teng','claude','${TENG}')`, /owner or an admin/);
await denied('Teng cannot change ownership', TENG, `update assets set owner_id='${HENRY}' where id='ast_teng'`, /only an admin/);
await as(TENG, `update members set role='admin' where user_id='${TENG}'`).catch(() => {});
ok('a member cannot self-promote', (await val(`select role from members where user_id='${TENG}'`))[0].role === 'creator');
await allowed('Teng starts a working chat on own ad', TENG, `insert into chats(id,title,asset_id,created_by) values ('33333333-3333-3333-3333-333333333333','Teng chat','ast_teng','${TENG}')`);
await as(TENG, `insert into chat_messages(chat_id,role,body) values ('33333333-3333-3333-3333-333333333333','user','private draft')`);
ok('Henry cannot read Teng’s working chat', (await q(HENRY, `select count(*)::int n from chats where id='33333333-3333-3333-3333-333333333333'`))[0].n === 0
  && (await q(HENRY, `select count(*)::int n from chat_messages where chat_id='33333333-3333-3333-3333-333333333333'`))[0].n === 0);
await denied('Henry cannot open a working chat on Teng’s ad', HENRY, `insert into chats(title,asset_id,created_by) values ('x','ast_teng','${HENRY}')`);
ok('admin can read any working chat', (await q(SHANE, `select count(*)::int n from chats where id='33333333-3333-3333-3333-333333333333'`))[0].n === 1);

// ---------- inboxes ----------
const inbox = async (uid, scope = 'mine') => (await q(uid, `select asset_id, pending from feedback_inbox('${scope}')`));
{ const t = await inbox(TENG), h = await inbox(HENRY), s = await inbox(SHANE);
  ok('Teng’s inbox: only his ad, 3 pending', t.length === 1 && t[0].asset_id === 'ast_teng' && t[0].pending === 3, JSON.stringify(t));
  ok('Henry’s inbox is empty (no feedback on his ad)', h.length === 0);
  ok('Shane’s personal inbox excludes others’ ads', s.length === 0); }
await denied('members cannot open the admin queue', TENG, `select * from feedback_inbox('all')`, /admin only/);
ok('admin queue shows everyone’s pending work', (await inbox(SHANE, 'all')).some(r => r.asset_id === 'ast_teng'));

// ---------- processing: review first, nothing executes ----------
let p = (await q(TENG, `select * from processing_start('ast_teng','app')`))[0];
ok('Process feedback opens a review of the latest version', p.status === 'reviewing' && p.reviewed_version_id === 'ast_teng_v1' && p.comment_ids.length === 3);
ok('starting a review changes nothing', (await val(`select latest_version from assets where id='ast_teng'`))[0].latest_version === 1
  && (await val(`select count(*)::int n from comments where asset_id='ast_teng' and status='open'`))[0].n === 3
  && (await val(`select count(*)::int n from revision_jobs where asset_id='ast_teng'`))[0].n === 0);
ok('Henry cannot read Teng’s processing draft', (await q(HENRY, `select count(*)::int n from processing`))[0].n === 0);
await denied('clients cannot write processing rows directly', TENG, `update processing set status='done' where id='${p.id}'`);
ok('direct write had no effect', (await val(`select status from processing where id='${p.id}'`))[0].status === 'reviewing');
const cs = Object.fromEntries((await val(`select body, id from comments where asset_id='ast_teng'`)).map(r => [r.body, r.id]));
const proposal = JSON.stringify({ summary: 'Headline vs CTA', items: [{ comment_ids: [cs['Shorter headline']], kind: 'compatible', change: 'Cut headline to 6 words' }, { comment_ids: [cs['Use the coral CTA'], cs['Note to self: bigger logo']], kind: 'conflict', change: 'Pick one' }] });
p = (await q(TENG, `select * from processing_save_proposal('${p.id}', ${p.rev}, '${proposal}')`))[0];
ok('proposal saved', p.proposal.items.length === 2);

// resume from Claude (same person, same record)
let p2 = (await q(TENG, `select * from processing_start('ast_teng','claude')`))[0];
ok('Claude resumes the same record with the same proposal', p2.id === p.id && p2.proposal.summary === 'Headline vs CTA' && p2.rev === p.rev);

// late feedback during review stays outside the snapshot
await as(HENRY, `insert into comments(asset_id,version_id,body) values ('ast_teng','ast_teng_v1','Late idea: add a cursor')`);
ok('late feedback is not in the review snapshot', !(await val(`select comment_ids from processing where id='${p.id}'`))[0].comment_ids.includes((await val(`select id from comments where body='Late idea: add a cursor'`))[0].id));

// stale rev is rejected (owner and admin can't silently overwrite each other)
await denied('stale review edits are rejected', TENG, `select processing_save_proposal('${p.id}', ${p.rev - 1}, '{}')`, /conflict/);

// admin takeover changes the processor, not the owner
p = (await q(SHANE, `select * from processing_start('ast_teng','claude')`))[0];
ok('admin takeover: processor is Shane', p.processor === SHANE && p.history.some(h => h.event === 'takeover'));
ok('admin takeover: owner unchanged and still in Teng’s inbox', (await val(`select owner_id from assets where id='ast_teng'`))[0].owner_id === TENG && (await inbox(TENG)).length === 1);
await denied('Teng’s stale rev after takeover is rejected', TENG, `select processing_save_proposal('${p.id}', ${p.rev - 1}, '{}')`, /conflict/);

// must choose: approving nothing is refused; the conflict item can be left undecided (stays pending)
await denied('Execute with nothing selected is refused', SHANE, `select processing_approve('${p.id}', ${p.rev}, '[]', '')`, /select at least one/);
const decisions = JSON.stringify([{ comment_id: cs['Shorter headline'], decision: 'apply', note: 'Henry’s headline' }, { comment_id: cs['Use the coral CTA'], decision: 'dismiss', note: 'Keeping current CTA' }]);
await denied('decisions must reference reviewed comments', SHANE, `select processing_approve('${p.id}', ${p.rev}, '[{"comment_id":"${(await val(`select id from comments where body='Late idea: add a cursor'`))[0].id}","decision":"apply"}]', 'x')`, /not part of this review/);
p = (await q(SHANE, `select * from processing_approve('${p.id}', ${p.rev}, '${decisions}', 'Apply Henry''s headline; keep current CTA', false)`))[0];
ok('approved selection recorded', p.status === 'approved' && p.decisions.length === 2);

// someone else saves a version mid-execution -> the result built on the old version is refused
await allowed('Teng saves v2 meanwhile', TENG, `insert into versions(id,asset_id,version,file_path) values ('x','ast_teng',0,'ast_teng/v2.png')`);
await denied('a version built on a stale parent is refused', SHANE, `insert into versions(id,asset_id,version,parent_version_id,file_path) values ('x','ast_teng',0,'ast_teng_v1','ast_teng/v3-from-v1.png')`, /stale_parent/);
await denied('completing with a version not built on the reviewed one is refused', SHANE, `select processing_complete('${p.id}', ${p.rev}, 'ast_teng_v2')`, /conflict/);
ok('failed completion leaves feedback pending', (await val(`select count(*)::int n from comments where asset_id='ast_teng' and status='open'`))[0].n === 4);
p = (await q(SHANE, `select * from processing_set_status('${p.id}', ${p.rev}, 'failed', 'Conflict with v2; reload')`))[0];
ok('failed execution keeps the last valid version', p.status === 'failed' && (await val(`select latest_version from assets where id='ast_teng'`))[0].latest_version === 2);

// fresh review on v2, execute, complete
p = (await q(TENG, `select * from processing_start('ast_teng','app')`))[0];
ok('new review starts on v2 with all open feedback', p.reviewed_version_id === 'ast_teng_v2' && p.comment_ids.length === 4);
const late = (await val(`select id from comments where body='Late idea: add a cursor'`))[0].id;
p = (await q(TENG, `select * from processing_approve('${p.id}', ${p.rev}, '${JSON.stringify([{ comment_id: cs['Shorter headline'], decision: 'apply' }, { comment_id: cs['Use the coral CTA'], decision: 'dismiss', note: 'Keep current CTA' }, { comment_id: cs['Note to self: bigger logo'], decision: 'defer' }])}', 'Shorter headline', true)`))[0];
ok('Execute changes queues one worker job tied to the review', (await val(`select count(*)::int n from revision_jobs where processing_id='${p.id}'`))[0].n === 1);
await allowed('result saved on top of the reviewed version', TENG, `insert into versions(id,asset_id,version,parent_version_id,file_path,revision_note,source) values ('x','ast_teng',0,'ast_teng_v2','ast_teng/v3.png','Shorter headline','{"processing_id":"${p.id}"}')`);
p = (await q(TENG, `select * from processing_complete('${p.id}', ${p.rev}, 'ast_teng_v3', 'Applied headline')`))[0];
const st = Object.fromEntries((await val(`select body, status, applied_in, resolution_note from comments where asset_id='ast_teng'`)).map(r => [r.body, r]));
ok('applied feedback resolved into v3', st['Shorter headline'].status === 'applied' && st['Shorter headline'].applied_in === 'ast_teng_v3');
ok('dismissed feedback keeps its reason', st['Use the coral CTA'].status === 'dismissed' && st['Use the coral CTA'].resolution_note === 'Keep current CTA');
ok('deferred and late feedback stay pending', st['Note to self: bigger logo'].status === 'open' && st['Late idea: add a cursor'].status === 'open');
ok('inbox still shows the remaining 2', (await inbox(TENG))[0].pending === 2);
ok('worker job closed with the result', (await val(`select state, result_version_id from revision_jobs where processing_id='${p.id}'`))[0].result_version_id === 'ast_teng_v3');

// ---------- revert ----------
await denied('revert with a stale latest is refused', TENG, `select revert_asset('ast_teng','ast_teng_v1','ast_teng_v2')`, /stale_parent/);
const rv = (await q(TENG, `select * from revert_asset('ast_teng','ast_teng_v1','ast_teng_v3')`))[0];
ok('revert creates v4 from v1, keeping v2 and v3', rv.id === 'ast_teng_v4' && rv.file_path === 'ast_teng/v1.png' && rv.source.reverted_from === 'ast_teng_v1'
  && (await val(`select count(*)::int n from versions where asset_id='ast_teng'`))[0].n === 4);

// ---------- approval stays with approvers ----------
await denied('a creator cannot give final approval, even on own ad', TENG, `insert into reviews(version_id,status) values ('ast_teng_v4','approved')`);
await allowed('admin approves a ready version', SHANE, `insert into reviews(version_id,status) values ('ast_teng_v4','approved')`);

// ---------- server path (Claude API) acts only as a verified member ----------
await denied('server acting for Henry still cannot process Teng’s ad', 'server', `select processing_start('ast_teng','claude','${HENRY}')`, /owner or an admin/);
ok('server acting for Teng can', (await q('server', `select status from processing_start('ast_teng','claude','${TENG}')`))[0].status === 'reviewing');
await denied('server without a named member is refused', 'server', `select feedback_inbox('mine')`, /not a member/);
ok('server inbox for Henry shows only Henry’s work', (await q('server', `select asset_id from feedback_inbox('mine','${HENRY}')`)).length === 0);

// ---------- personal API tokens ----------
const tok = (await q(TENG, `select * from api_token_create('Teng laptop Claude')`))[0];
ok('token shown once, stored hashed', tok.token.startsWith('yas_') && (await val(`select count(*)::int n from api_tokens where token_hash = encode(sha256(convert_to('${tok.token}','UTF8')),'hex')`))[0].n === 1
  && (await val(`select count(*)::int n from api_tokens where token_hash = '${tok.token}'`))[0].n === 0);
ok('members see only their own tokens', (await q(HENRY, `select count(*)::int n from api_tokens`))[0].n === 0 && (await q(TENG, `select count(*)::int n from api_tokens`))[0].n === 1);
await denied('members cannot resolve tokens', HENRY, `select * from api_token_resolve('x')`);
const res = (await q('server', `select * from api_token_resolve(encode(sha256(convert_to('${tok.token}','UTF8')),'hex'))`))[0];
ok('server resolves a token to its member (not admin)', res.user_id === TENG && res.role === 'creator');
await denied('Henry cannot revoke Teng\u2019s token', HENRY, `select api_token_revoke('${tok.id}')`);
await allowed('Teng revokes his token', TENG, `select api_token_revoke('${tok.id}')`);
ok('revoked token resolves to nothing', (await q('server', `select * from api_token_resolve(encode(sha256(convert_to('${tok.token}','UTF8')),'hex'))`)).length === 0);

// ---------- idempotent saves ----------
await allowed('save with an idempotency key', TENG, `insert into versions(id,asset_id,version,file_path,source) values ('x','ast_teng',0,'ast_teng/v5.png','{"idempotency_key":"k1"}')`);
await denied('a retried save does not duplicate the version', TENG, `insert into versions(id,asset_id,version,file_path,source) values ('x','ast_teng',0,'ast_teng/v5.png','{"idempotency_key":"k1"}')`, /duplicate|unique/);

// ---------- Slack provenance ----------
await allowed('member comment', HENRY, `insert into comments(asset_id,version_id,body,source,source_ref,source_link) values ('ast_teng','ast_teng_v1','fake slack','slack','C1:1.1','https://evil')`);
ok('clients cannot forge Slack provenance', (await val(`select source, source_ref from comments where body='fake slack'`))[0].source === 'app' && (await val(`select source_ref from comments where body='fake slack'`))[0].source_ref === null);
await db.exec(`insert into comments(asset_id,version_id,body,author,source,source_ref,source_link) values ('ast_teng','ast_teng_v1','From Slack','${HENRY}','slack','C1:2.2','https://slack/p')`);
try { await db.exec(`insert into comments(asset_id,version_id,body,author,source,source_ref) values ('ast_teng','ast_teng_v1','From Slack again','${HENRY}','slack','C1:2.2')`); ok('a Slack message becomes one comment, even on retry', false); }
catch { ok('a Slack message becomes one comment, even on retry', true); }
await denied('members cannot write Slack posts directly', TENG, `insert into slack_posts(asset_id,version_id,channel_id,idempotency_key) values ('ast_teng','ast_teng_v1','C1','k')`);
ok('identity mapping is server-only', (await q(TENG, `select count(*)::int n from slack_users`))[0].n === 0);

// ---------- accepting feedback reopens an approved ad ----------
await allowed('Henry makes and Shane approves a ready ad', HENRY, `insert into assets(id,concept_name,kind,format) values ('ast_ok','Approved ad','static','square'); insert into versions(id,asset_id,version,file_path) values ('x','ast_ok',0,'ast_ok/v1.png')`);
await as(SHANE, `insert into reviews(version_id,status) values ('ast_ok_v1','approved')`);
await as(TENG, `insert into comments(asset_id,version_id,body) values ('ast_ok','ast_ok_v1','Change the CTA'), ('ast_ok','ast_ok_v1','Nice')`);
let pk = (await q(HENRY, `select * from processing_start('ast_ok','app')`))[0];
const okIds = Object.fromEntries((await val(`select body, id from comments where asset_id='ast_ok'`)).map(r => [r.body, r.id]));
await as(HENRY, `select processing_save_proposal('${pk.id}', ${pk.rev}, '{"draft":{"decisions":[{"comment_id":"${okIds['Change the CTA']}","decision":"apply"}]}}')`);
ok('saving a draft Accept does not reopen it', (await val(`select status from reviews where version_id='ast_ok_v1'`))[0].status === 'approved');
pk = (await q(HENRY, `select * from processing where id='${pk.id}'`))[0];
await as(HENRY, `select processing_approve('${pk.id}', ${pk.rev}, '[{"comment_id":"${okIds['Change the CTA']}","decision":"apply"},{"comment_id":"${okIds['Nice']}","decision":"dismiss"}]', '', false)`);
{ const r = (await val(`select status, reviewer, note from reviews where version_id='ast_ok_v1'`))[0];
  ok('committing accepted feedback takes the ad out of Approved', r.status === 'changes' && r.reviewer === HENRY && /Reopened/.test(r.note)); }
ok('the earlier approval stays in history', (await val(`select array_agg(status order by id) s from review_history where version_id='ast_ok_v1'`))[0].s.join() === 'approved,changes');
// ignoring everything does not reopen
await allowed('another approved ad', HENRY, `insert into assets(id,concept_name,kind,format) values ('ast_ok2','Approved ad 2','static','square'); insert into versions(id,asset_id,version,file_path) values ('x','ast_ok2',0,'ast_ok2/v1.png')`);
await as(SHANE, `insert into reviews(version_id,status) values ('ast_ok2_v1','approved')`);
await as(TENG, `insert into comments(asset_id,version_id,body) values ('ast_ok2','ast_ok2_v1','Meh')`);
pk = (await q(HENRY, `select * from processing_start('ast_ok2','app')`))[0];
await allowed('closing only ignored feedback', HENRY, `select processing_approve('${pk.id}', ${pk.rev}, '[{"comment_id":"${(await val(`select id from comments where asset_id='ast_ok2'`))[0].id}","decision":"dismiss","note":"Off brief"}]', '', true)`);
ok('ignored feedback is closed with its reason, no version, no worker job', (await val(`select status, resolution_note from comments where asset_id='ast_ok2'`))[0].resolution_note === 'Off brief'
  && (await val(`select latest_version from assets where id='ast_ok2'`))[0].latest_version === 1 && (await val(`select count(*)::int n from revision_jobs where asset_id='ast_ok2'`))[0].n === 0);
ok('an ad with only ignored feedback stays approved', (await val(`select status from reviews where version_id='ast_ok2_v1'`))[0].status === 'approved');
await denied('nothing chosen at all is still refused', HENRY, `select processing_approve(p.id, p.rev, '[]', '', false) from processing_start('ast_ok','app') p`, /already|select at least one/);

// ---------- change log ----------
{ const log = (await q(TENG, `select change_log('ast_teng') l`))[0].l;
  const v3 = log.find(e => e.version === 3);
  ok('change log: each version with what changed and who made it', log.filter(e => e.kind === 'version').length >= 4 && v3.what_changed === 'Shorter headline' && v3.from_version === 2);
  ok('change log: accepted and ignored comments with authors and reasons', v3.round.accepted[0].body === 'Shorter headline' && v3.round.accepted[0].author === 'Henry'
    && v3.round.ignored[0].body === 'Use the coral CTA' && v3.round.ignored[0].reason === 'Keep current CTA');
  ok('change log: reverts are labelled', log.some(e => e.reverted_from === 1)); }
ok('any member can read the change log (decisions are the team record)', (await q(HENRY, `select jsonb_array_length(change_log('ast_teng')) n`))[0].n >= 4);
{ const log = (await q(HENRY, `select change_log('ast_ok2') l`))[0].l;
  ok('a round that only ignored feedback is recorded too', log.some(e => e.kind === 'closed' && e.round.ignored[0].reason === 'Off brief')); }
await db.exec(`insert into assets(id,concept_name,kind,format,created_by,owner_id) values ('ast_leg','Legacy','static','square','${TENG}','${TENG}');
  insert into versions(id,asset_id,version,file_path) values ('x','ast_leg',0,'ast_leg/v1.png'); insert into versions(id,asset_id,version,file_path,revision_note) values ('x','ast_leg',0,'ast_leg/v2.png','Bigger logo');
  insert into comments(asset_id,version_id,body,author,status,applied_in) values ('ast_leg','ast_leg_v1','Make the logo bigger','${HENRY}','applied','ast_leg_v2');`);
ok('older versions show the comments used in them', (await q(HENRY, `select change_log('ast_leg') l`))[0].l.find(e => e.version === 2).round.accepted[0].body === 'Make the logo bigger');
ok('drafts are not in the change log', !JSON.stringify((await q(HENRY, `select change_log('ast_ok') l`))[0].l).includes('"note":"From'));

// ---------- Higgsfield rendering versions ----------
await allowed('member saves a rendering version', HENRY, `insert into assets(id,concept_name,kind,format) values ('ast_hf','HF','video','vertical'); insert into versions(id,asset_id,version,render) values ('x','ast_hf',0,'{"state":"rendering","label":"Rendering in Higgsfield"}')`);
await as(HENRY, `update versions set file_path='ast_hf/x.mp4', render='{"state":"ready"}' where id='ast_hf_v1'`).catch(() => {});
ok('a member cannot fill in a rendering version', (await val(`select file_path from versions where id='ast_hf_v1'`))[0].file_path === null);
await db.exec(`update versions set file_path='ast_hf/v1.mp4', content_type='video/mp4', render='{"state":"ready","kind":"higgsfield"}' where id='ast_hf_v1'`);
ok('the server fills in a rendering version once', (await val(`select file_path, render->>'state' s from versions where id='ast_hf_v1'`))[0].s === 'ready');
try { await db.exec(`update versions set file_path='ast_hf/other.mp4' where id='ast_hf_v1'`); ok('a finished version cannot be changed again', false); } catch { ok('a finished version cannot be changed again', true); }
try { await db.exec(`update versions set revision_note='x', file_path='ast_hf/v1.mp4' where id='ast_teng_v1'`); ok('ready versions stay immutable for the server', false); } catch { ok('ready versions stay immutable for the server', true); }
await denied('members cannot create Higgsfield jobs directly', HENRY, `insert into higgsfield_jobs(asset_id,version_id,requested_by,idempotency_key,prompt,duration,aspect_ratio) values ('ast_hf','ast_hf_v1','${HENRY}','k','p',9,'9:16')`);

// ---------- one kind of feedback: approve / reject, then Process all approved ----------
await as(TENG, `insert into assets(id,concept_name,kind,format) values ('ast_fb','FB','static','square'); insert into versions(id,asset_id,version,file_path,content_type) values ('x','ast_fb',0,'ast_fb/1.png','image/png')`);
await as(HENRY, `insert into comments(asset_id,version_id,body) values ('ast_fb','ast_fb_v1','make the logo bigger'),('ast_fb','ast_fb_v1','change the color'),('ast_fb','ast_fb_v1','undecided one')`);
const fb = async b => (await val(`select id from comments where asset_id='ast_fb' and body='${b}'`))[0].id;
const [logo, color, und] = [await fb('make the logo bigger'), await fb('change the color'), await fb('undecided one')];
await denied('a non-owner cannot approve feedback', HENRY, `select feedback_decide('${logo}','approved')`, /owner or an admin/);
await allowed('owner approves feedback', TENG, `select feedback_decide('${logo}','approved')`);
await allowed('owner rejects feedback', TENG, `select feedback_decide('${color}','rejected','off brand')`);
ok('rejected feedback is closed with the reason', (await val(`select status, resolution_note from comments where id='${color}'`))[0].resolution_note === 'off brand');
await as(TENG, `insert into reviews(version_id,status) values ('ast_fb_v1','approved')`).catch(() => {});
// new feedback arrives after earlier decisions and is approved too: it must be included
await as(HENRY, `insert into comments(asset_id,version_id,body) values ('ast_fb','ast_fb_v1','late but approved')`);
const lateFb = await fb('late but approved');
await as(TENG, `select feedback_decide('${lateFb}','approved')`);
await denied('Process needs something approved', HENRY, `select feedback_process('ast_fb')`, /owner or an admin/);
await allowed('owner presses Process', TENG, `select feedback_process('ast_fb', 'keep it simple')`);
const pr = (await val(`select * from processing where asset_id='ast_fb' and status='approved'`))[0];
ok('Process takes every approved item, including late ones; not rejected or undecided', pr && pr.comment_ids.length === 2 && pr.comment_ids.includes(logo) && pr.comment_ids.includes(lateFb) && !pr.comment_ids.includes(und) && !pr.comment_ids.includes(color));
ok('note goes along as instructions', pr.instructions === 'keep it simple');
ok('a revision job is queued for the worker', (await val(`select count(*)::int n from revision_jobs where processing_id='${pr.id}' and state='queued'`))[0].n === 1);
await denied('approved feedback in progress cannot be changed', TENG, `select feedback_decide('${logo}','rejected')`, /already going/);
await denied('cannot Process twice while a version is being made', TENG, `select feedback_process('ast_fb')`, /already being made/);
await allowed('undo a rejection', TENG, `select feedback_decide('${color}','undecided')`);
ok('undone feedback is open again', (await val(`select status from comments where id='${color}'`))[0].status === 'open');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
