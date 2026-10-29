// Runs the real loop migration in PGlite (Postgres in WASM) with Supabase's roles, auth.users
// and auth.uid() shimmed, then checks who can do what. Usage: node supabase/tests/schema.test.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(path.join(here, '../migrations/20261029000001_loop.sql'), 'utf8');
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
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`);
await db.exec(migration);
await db.exec(readFileSync(path.join(here, '../migrations/20261029154845_collaborator_review_reliability.sql'), 'utf8'));
await db.exec(readFileSync(path.join(here, '../migrations/20261029191333_voice_comments.sql'), 'utf8'));
await db.exec(readFileSync(path.join(here, '../migrations/20261029192856_revision_jobs.sql'), 'utf8').replace(/^alter publication.*$/m, ''));
await db.exec(readFileSync(path.join(here, '../migrations/20261029194145_reject_cancels_revisions.sql'), 'utf8'));
await db.exec(readFileSync(path.join(here, '../migrations/20261029211304_ownership_processing.sql'), 'utf8'));
ok('migration applies', true);

const SHANE = '00000000-0000-0000-0000-00000000000a', TENG = '00000000-0000-0000-0000-00000000000c',
  VIEW = '00000000-0000-0000-0000-00000000000f', OUT = '00000000-0000-0000-0000-000000000099', HENRY = '00000000-0000-0000-0000-0000000000cc';
await db.exec(`insert into role_grants values ('shane.wilson@yokegtm.com','admin'),('viewer@example.com','viewer');`);
await db.exec(`insert into auth.users(id,email) values ('${SHANE}','Shane.Wilson@yokegtm.com'),('${TENG}','teng.he@yokegtm.com'),
  ('${VIEW}','viewer@example.com'),('${OUT}','stranger@gmail.com'),('${HENRY}','henry@yokegtm.com');`);
const roles = Object.fromEntries((await db.query(`select email, role from members`)).rows.map(r => [r.email, r.role]));
ok('domain users join as creator', roles['teng.he@yokegtm.com'] === 'creator' && roles['henry@yokegtm.com'] === 'creator');
ok('granted roles applied', roles['shane.wilson@yokegtm.com'] === 'admin' && roles['viewer@example.com'] === 'viewer');
ok('outside email gets no membership', !('stranger@gmail.com' in roles));

async function as(uid, sql) {
  const claims = uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : JSON.stringify({ role: 'anon' });
  try {
    const r = await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claims', '${claims}', false); ${sql};`);
    return r[r.length - 1];
  } finally { await db.exec(`reset role; select set_config('request.jwt.claims','',false);`); }
}
const rows = async (uid, sql) => (await as(uid, sql)).rows;
const allowed = async (name, uid, sql) => { try { await as(uid, sql); ok(name, true); } catch (e) { ok(name, false, first(e)); } };
const denied = async (name, uid, sql) => { try { await as(uid, sql); ok(name, false, 'was allowed'); } catch (e) { ok(name, true, first(e)); } };

// ---------- create ----------
await allowed('creator creates an asset', TENG, `insert into assets(id,concept_name,kind,format) values ('ast_t','Test','static','feed45')`);
ok('asset created_by is the signed-in user', (await db.query(`select created_by from assets where id='ast_t'`)).rows[0].created_by === TENG);
await allowed('creator adds v1 (forged author ignored)', TENG, `insert into versions(id,asset_id,version,file_path,content_type,created_by) values ('x','ast_t',99,'a/1.png','image/png','${SHANE}')`);
let v = (await db.query(`select id,version,created_by from versions where asset_id='ast_t'`)).rows[0];
ok('server assigns id and number', v.id === 'ast_t_v1' && v.version === 1);
ok('version author bound to signed-in user', v.created_by === TENG);
// two writers iterating at once: numbers never collide
await Promise.all([as(TENG, `insert into versions(id,asset_id,version,file_path) values ('a','ast_t',1,'a/2.png')`),
                   as(SHANE, `insert into versions(id,asset_id,version,file_path) values ('b','ast_t',1,'a/3.png')`)]);
const vs = (await db.query(`select version, parent_version_id from versions where asset_id='ast_t' order by version`)).rows;
ok('concurrent iterations get v2 and v3', vs.map(r => r.version).join() === '1,2,3', vs.map(r => r.version).join());
ok('parent links to previous version', vs[2].parent_version_id === 'ast_t_v2');
await as(SHANE, `update versions set revision_note='x' where id='ast_t_v1'`).catch(() => {});
await as(SHANE, `delete from versions where id='ast_t_v1'`).catch(() => {});
ok('versions unchanged by users', (await db.query(`select count(*)::int n, max(revision_note) r from versions where id='ast_t_v1'`)).rows[0].n === 1);
try { await db.exec(`update versions set revision_note='x' where id='ast_t_v1'`); ok('versions immutable even for the server', false); } catch (e) { ok('versions immutable even for the server', true, first(e)); }
await denied('pending version needs pending state', TENG, `insert into versions(id,asset_id,version) values ('p','ast_t',1)`);
await allowed('pending Higgsfield version allowed', TENG, `insert into versions(id,asset_id,version,render) values ('p','ast_t',1,'{"state":"pending","label":"Waiting on Higgsfield"}')`);
await denied('user cannot bump latest_version', TENG, `update assets set latest_version=50 where id='ast_t'`);
await allowed('user can archive / rename', TENG, `update assets set archived=true, concept_name='Renamed' where id='ast_t'`);

// ---------- read access ----------
ok('member reads Library', (await rows(VIEW, `select id from assets`)).length === 1);
ok('outsider reads nothing', (await rows(OUT, `select id from assets`)).length === 0);
await denied('anonymous reads nothing', null, `select id from assets`);
await denied('viewer cannot create', VIEW, `insert into assets(concept_name,kind,format) values ('v','static','square')`);
await denied('outsider cannot create', OUT, `insert into assets(concept_name,kind,format) values ('o','static','square')`);

// ---------- feedback loop ----------
await allowed('creator comments', TENG, `insert into comments(asset_id,version_id,body,author) values ('ast_t','ast_t_v1','Hook too long','${SHANE}')`);
ok('comment author bound', (await db.query(`select author from comments`)).rows[0].author === TENG);
await allowed('comment status change', SHANE, `update comments set status='applied', applied_in='ast_t_v2'`);
await denied('comment text is fixed', SHANE, `update comments set body='edited'`);
await allowed('voice note comment', TENG, `insert into comments(asset_id,version_id,body,at_sec,audio_path,audio_sec) values ('ast_t','ast_t_v1','Voice note',1.5,'comments/ast_t/a.webm',12.4)`);
await denied('voice note must live under its ad', TENG, `insert into comments(asset_id,version_id,body,audio_path,audio_sec) values ('ast_t','ast_t_v1','Voice note','ast_other/a.webm',3)`);
await denied('voice note audio is fixed', SHANE, `update comments set audio_path='comments/ast_t/b.webm' where audio_path is not null`);
await denied('creator cannot approve', TENG, `insert into reviews(version_id,status) values ('ast_t_v1','approved')`);
await allowed('admin approves', SHANE, `insert into reviews(version_id,status,reviewer) values ('ast_t_v1','approved','${TENG}')`);
ok('review by bound to approver', (await db.query(`select reviewer from reviews`)).rows[0].reviewer === SHANE);
await allowed('admin changes decision', SHANE, `update reviews set status='changes', note='Shorter' where version_id='ast_t_v1'`);
ok('review history kept', (await db.query(`select count(*)::int n from review_history`)).rows[0].n === 2);
ok('request changes no longer starts an edit by itself', (await db.query(`select count(*)::int n from revision_jobs`)).rows[0].n === 0);
await db.exec(`insert into revision_jobs(asset_id,version_id,note) values ('ast_t','ast_t_v1','legacy queued job')`);
await denied('clients cannot create jobs', SHANE, `insert into revision_jobs(asset_id,version_id) values ('ast_t','ast_t_v1')`);
{ await as(SHANE, `update revision_jobs set state='done'`).catch(() => {});
  ok('clients cannot change job state', (await db.query(`select state from revision_jobs`)).rows[0].state === 'queued'); }
ok('owner reads own jobs', (await as(TENG, `select count(*)::int n from revision_jobs`)).rows[0].n === 1);
ok('viewers cannot read jobs (private working record)', (await as(VIEW, `select count(*)::int n from revision_jobs`)).rows[0].n === 0);
await as(TENG, `update assets set archived = false where id = 'ast_t'`);
await allowed('creator rejects an ad', TENG, `update assets set archived = true, archived_note = 'Rejected by Teng' where id = 'ast_t'`);
{ const r = (await db.query(`select j.state, a.archived from revision_jobs j join assets a on a.id = j.asset_id`)).rows; ok('rejecting cancels queued revisions', r[0].state === 'cancelled', JSON.stringify(r)); }
await as(TENG, `update assets set archived = false where id = 'ast_t'`);
await allowed('share recorded', TENG, `insert into shares(asset_id,version_id,channel,note) values ('ast_t','ast_t_v1','#creative-review',null)`);
await denied('share cannot be forged', TENG, `insert into shares(asset_id,version_id,channel,shared_by) values ('ast_t','ast_t_v1','#x','${SHANE}')`);
await as(SHANE, `delete from shares`).catch(() => {});
ok('shares append-only', (await db.query(`select count(*)::int n from shares`)).rows[0].n === 1);

// ---------- conversations ----------
await allowed('creator starts a chat', TENG, `insert into chats(id,title,create_type,created_by) values ('11111111-1111-1111-1111-111111111111','Idea','motion','${TENG}')`);
await allowed('user message', SHANE, `insert into chat_messages(chat_id,role,body,create_type) values ('11111111-1111-1111-1111-111111111111','user','Make it shorter','static')`);
ok('message author bound + chat touched', (await db.query(`select m.author, c.last_by from chat_messages m join chats c on c.id=m.chat_id`)).rows.every(r => r.author === SHANE && r.last_by === SHANE));
await denied('users cannot write assistant messages', TENG, `insert into chat_messages(chat_id,role,body) values ('11111111-1111-1111-1111-111111111111','assistant','fake')`);
try { await db.exec(`select set_config('request.jwt.claims','{"role":"service_role"}',false); set role service_role; insert into chat_messages(chat_id,role,body) values ('11111111-1111-1111-1111-111111111111','assistant','ok'); reset role; select set_config('request.jwt.claims','',false);`); ok('server writes assistant messages', true); } catch (e) { ok('server writes assistant messages', false, first(e)); await db.exec('reset role'); }
await as(SHANE, `update chat_messages set body='x'`).catch(() => {});
ok('messages append-only', (await db.query(`select count(*)::int n from chat_messages where body='x'`)).rows[0].n === 0);

// ---------- feedback utility ----------
await allowed('viewer can send feedback', VIEW, `insert into feedback(id,type,body,submitted_by) values ('fb_1','bug','Broken','${VIEW}')`);
await denied('feedback cannot be forged', VIEW, `insert into feedback(id,type,body,submitted_by) values ('fb_2','bug','x','${SHANE}')`);
await as(VIEW, `update feedback set delivery='{}'`).catch(() => {});
ok('feedback delivery unchanged', (await db.query(`select delivery->'slack'->>'state' s from feedback`)).rows[0].s === 'pending');

// ---------- admin ----------
await as(TENG, `update members set role='admin' where user_id='${TENG}'`).catch(() => {});
ok('role unchanged', (await db.query(`select role from members where user_id='${TENG}'`)).rows[0].role === 'creator');
await allowed('admin grants a role', SHANE, `insert into role_grants values ('contractor@example.com','viewer')`);

// ---------- rollout regressions ----------
await denied('pending media cannot be approved', SHANE, `insert into reviews(version_id,status) values ('ast_t_v4','approved')`);
await allowed('pending media may receive a change request', SHANE, `insert into reviews(version_id,status) values ('ast_t_v4','changes')`);
await denied('change request cannot become approval while media is pending', SHANE, `update reviews set status='approved' where version_id='ast_t_v4'`);
ok('rejected approval preserves review state', (await db.query(`select status from reviews where version_id='ast_t_v4'`)).rows[0].status === 'changes');
await as(TENG, `insert into versions(id,asset_id,version,file_path,qa) values ('x','ast_t',0,'a/failed.png','[{"status":"fail"}]')`);
await denied('failed checks block approval in the database', SHANE, `insert into reviews(version_id,status) values ('ast_t_v5','approved')`);
await as(TENG, `insert into versions(id,asset_id,version,file_path) values ('x','ast_t',0,'')`);
await denied('empty file path cannot be approved', SHANE, `insert into reviews(version_id,status) values ('ast_t_v6','approved')`);
await as(TENG, `insert into versions(id,asset_id,version,file_path,render) values ('x','ast_t',0,'a/rendering.mp4','{"state":"rendering"}')`);
await denied('a render still in progress cannot be approved', SHANE, `insert into reviews(version_id,status) values ('ast_t_v7','approved')`);
await as(TENG, `insert into versions(id,asset_id,version,file_path) values ('x','ast_t',0,'a/ready.png')`);
await allowed('ready media can be approved', SHANE, `insert into reviews(version_id,status) values ('ast_t_v8','approved')`);
const request = (await rows(TENG, `insert into chat_messages(chat_id,role,body) values ('11111111-1111-1111-1111-111111111111','user','Retry me') returning id`))[0].id;
await db.exec(`insert into chat_messages(chat_id,role,body,reply_to) values ('11111111-1111-1111-1111-111111111111','assistant','Saved response','${request}')`);
try { await db.exec(`insert into chat_messages(chat_id,role,body,reply_to) values ('11111111-1111-1111-1111-111111111111','assistant','Duplicate','${request}')`); ok('duplicate replies prevented', false); }
catch { ok('duplicate replies prevented', true); }
await denied('a user cannot claim a reply slot', TENG, `insert into chat_messages(chat_id,role,body,reply_to) values ('11111111-1111-1111-1111-111111111111','user','fake','${request}')`);
await db.exec(`insert into chats(id,title) values ('22222222-2222-2222-2222-222222222222','Other chat')`);
try { await db.exec(`insert into chat_messages(chat_id,role,body,reply_to) values ('22222222-2222-2222-2222-222222222222','assistant','Wrong chat','${request}')`); ok('cross-chat replies prevented', false); }
catch { ok('cross-chat replies prevented', true); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
