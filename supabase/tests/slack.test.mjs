// Slack sharing and thread ingestion: real server code (src/lib/server/slack.ts) against every migration in PGlite,
// with a fake Slack. Usage: node supabase/tests/slack.test.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { pgClient } from './pgshim.mjs';

const here = import.meta.dirname; const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const mod = (() => { const code = ts.transpileModule(readFileSync(path.join(root, 'src/lib/server/slack.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} }; new Function('require', 'module', 'exports', code)(require, m, m.exports); return m.exports; })();
const { verifySlackSignature, parseTimecode, shareVersion, handleSlackEvent } = mod;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`); };

const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;`);
for (const f of readdirSync(path.join(here, '../migrations')).filter(f => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(path.join(here, '../migrations', f), 'utf8');
  await db.exec(sql.split('-- @supabase-only')[0].replace(/^alter publication.*$/gm, ''));
}
const SHANE = '00000000-0000-0000-0000-00000000000a', TENG = '00000000-0000-0000-0000-00000000000c', HENRY = '00000000-0000-0000-0000-0000000000cc';
await db.exec(`insert into role_grants values ('shane.wilson@yokegtm.com','admin');
  insert into auth.users(id,email) values ('${SHANE}','shane.wilson@yokegtm.com'),('${TENG}','teng.he@yokegtm.com'),('${HENRY}','henry@yokegtm.com');
  insert into assets(id,concept_name,kind,format,created_by,owner_id) values ('ast_t','Teng ad','motion','vertical','${TENG}','${TENG}');
  insert into versions(id,asset_id,version,file_path,poster_path,content_type) values ('x','ast_t',0,'ast_t/v1.mp4','ast_t/v1.jpg','video/mp4');`);
const sdb = pgClient(db);

// fake Slack
const slackUsers = { UTENG: 'teng.he@yokegtm.com', UHENRY: 'henry@yokegtm.com', USTRANGER: 'someone@gmail.com' };
const calls = []; let failNextPost = null; let tsN = 100; let fileScopes = false; const files = {};
const slack = async (method, args) => {
  calls.push({ method, args });
  if (method === 'chat.postMessage') { if (failNextPost) { const e = failNextPost; failNextPost = null; return { ok: false, error: e }; } return { ok: true, channel: args.channel, ts: `17000.${tsN++}` }; }
  if (method === 'chat.getPermalink') return { ok: true, permalink: `https://yoke.slack.com/archives/${args.channel}/p${String(args.message_ts).replace('.', '')}` };
  if (method === 'users.info') return { ok: true, user: { id: args.user, profile: { email: slackUsers[args.user] } } };
  if (method === 'files.getUploadURLExternal') { if (!fileScopes) return { ok: false, error: 'missing_scope' }; const id = 'F' + (tsN++); files[id] = { length: args.length }; return { ok: true, upload_url: 'https://files.slack.example/upload/' + id, file_id: id }; }
  if (method === 'files.completeUploadExternal') { const f = args.files[0]; files[f.id].shared = { channel: args.channel_id, ts: `17000.${tsN++}`, comment: args.initial_comment }; return { ok: true }; }
  if (method === 'files.info') { const f = files[args.file]; return { ok: true, file: { shares: f?.shared ? { private: { [f.shared.channel]: [{ ts: f.shared.ts }] } } : {} } }; }
  if (method === 'users.lookupByEmail') { const id = Object.entries(slackUsers).find(([, e]) => e === args.email)?.[0]; return id ? { ok: true, user: { id } } : { ok: false }; }
  return { ok: true };
};
const posts = () => calls.filter(c => c.method === 'chat.postMessage');
const uploads = []; const uploader = async (url, bytes, name) => { uploads.push({ url, bytes: bytes.length, name }); return true; };
const APP = 'https://studio.example';
const teng = { user_id: TENG, role: 'creator', display_name: 'Teng He' }, henry = { user_id: HENRY, role: 'creator', display_name: 'Henry' }, shane = { user_id: SHANE, role: 'admin', display_name: 'Shane' };

// ---------- signatures ----------
const secret = 'test-secret'; const body = '{"type":"event_callback"}'; const t = String(Math.floor(Date.now() / 1000));
const sig = 'v0=' + createHmac('sha256', secret).update(`v0:${t}:${body}`).digest('hex');
ok('valid Slack signature accepted', verifySlackSignature(body, t, sig, secret));
ok('tampered body rejected', !verifySlackSignature(body + ' ', t, sig, secret));
ok('old timestamp rejected (replay)', !verifySlackSignature(body, String(Number(t) - 600), 'v0=' + createHmac('sha256', secret).update(`v0:${Number(t) - 600}:${body}`).digest('hex'), secret));
ok('missing signature rejected', !verifySlackSignature(body, t, null, secret));
ok('timecodes parsed', parseTimecode('at 0:07 the logo is small') === 7 && parseTimecode('1:02 too fast') === 62 && parseTimecode('looks great') === null);

// ---------- share ----------
let r = await shareVersion(sdb, slack, henry, { asset_id: 'ast_t', version_id: 'ast_t_v1', channel_id: 'CTEST0001', idempotency_key: 'h1' }, APP, uploader);
ok('a non-owner cannot post someone else’s ad', r.status === 403 && posts().length === 0);
r = await shareVersion(sdb, slack, teng, { asset_id: 'ast_t', version_id: 'ast_t_v1', channel_id: 'general', idempotency_key: 'k0' }, APP, uploader);
ok('channel must be a picked channel id', r.status === 400 && posts().length === 0);
failNextPost = 'not_in_channel';
r = await shareVersion(sdb, slack, teng, { asset_id: 'ast_t', version_id: 'ast_t_v1', channel_id: 'CTEST0001', question: null, idempotency_key: 'k1' }, APP, uploader);
ok('a failed post is reported, not faked', r.status === 502 && /Invite it first/.test(r.body.message));
r = await shareVersion(sdb, slack, teng, { asset_id: 'ast_t', version_id: 'ast_t_v1', channel_id: 'CTEST0001', question: null, idempotency_key: 'k1' }, APP, uploader);
const post = r.body;
ok('retry posts once and records the thread', r.status === 200 && post.state === 'sent' && post.ts && posts().length === 2);
ok('without file permissions a video falls back to the poster and says so', /files:write/.test(r.body.note || '') && r.body.video === false);
const blocks = JSON.stringify(posts()[1].args.blocks);
ok('post carries the exact version link and a preview', blocks.includes(`${APP}/a/ast_t?v=ast_t_v1`) && blocks.includes('"type":"image"'));
ok('no question is required', !blocks.includes('> '));
r = await shareVersion(sdb, slack, teng, { asset_id: 'ast_t', version_id: 'ast_t_v1', channel_id: 'CTEST0001', idempotency_key: 'k1' }, APP, uploader);
ok('repeating a delivered share does not post again', r.body.duplicate === true && posts().length === 2);
ok('saving and posting are separate (no new version)', (await db.query(`select count(*)::int n from versions where asset_id='ast_t'`)).rows[0].n === 1);

// with file permissions, the real video is the post and replies thread on it
fileScopes = true;
const vr = await shareVersion(sdb, slack, teng, { asset_id: 'ast_t', version_id: 'ast_t_v1', channel_id: 'CTEST0001', question: 'Too fast?', idempotency_key: 'kv' }, APP, uploader);
const shared = Object.values(files).find(f => f.shared)?.shared;
ok('a video is uploaded as the real file and becomes the review post', vr.status === 200 && vr.body.video === true && uploads.length === 1 && shared && vr.body.ts === shared.ts, JSON.stringify(vr.body).slice(0, 160));
ok('the video post carries the version link and question', shared.comment.includes(`${APP}/a/ast_t?v=ast_t_v1`) && shared.comment.includes('Too fast?'));
ok('no extra text message for a video post', posts().length === 2);
await db.exec(`update slack_posts set state='failed' where idempotency_key='kv'`); // keep later assertions on the first post's thread
fileScopes = false;

// meanwhile the owner saves v2 -- replies to the v1 thread must stay on v1
await db.exec(`insert into versions(id,asset_id,version,file_path,content_type) values ('x','ast_t',0,'ast_t/v2.mp4','video/mp4')`);

// ---------- thread replies ----------
const ev = (id, event) => ({ type: 'event_callback', event_id: id, team_id: 'T1', event: { channel: 'CTEST0001', ...event } });
const before = posts().length;
let o = await handleSlackEvent(sdb, slack, ev('E1', { type: 'message', user: 'UHENRY', text: 'At 0:03 the logo is tiny', ts: '17000.500', thread_ts: post.ts }), APP);
const c1 = (await db.query(`select * from comments where source='slack'`)).rows;
ok('a thread reply becomes one comment', o === 'comment_saved' && c1.length === 1, o);
ok('pinned to the shared version, not the latest', c1[0].version_id === 'ast_t_v1');
ok('attributed to the verified member', c1[0].author === HENRY);
ok('keeps the Slack link and timecode', /archives\/CTEST0001\/p17000500/.test(c1[0].source_link) && Number(c1[0].at_sec) === 3);
ok('owner gets a pending item in their inbox', (await db.query(`select pending from feedback_inbox('mine','${TENG}')`)).rows[0]?.pending === 1);
ok('owner is notified once by DM', posts().length === before + 1 && posts().at(-1).args.channel === 'UTENG');
o = await handleSlackEvent(sdb, slack, ev('E1', { type: 'message', user: 'UHENRY', text: 'At 0:03 the logo is tiny', ts: '17000.500', thread_ts: post.ts }), APP);
ok('a retried event is ignored', o === 'duplicate_event');
o = await handleSlackEvent(sdb, slack, ev('E1b', { type: 'message', user: 'UHENRY', text: 'At 0:03 the logo is tiny', ts: '17000.500', thread_ts: post.ts }), APP);
ok('the same message under a new event id is still one comment', o === 'duplicate_message' && (await db.query(`select count(*)::int n from comments where source='slack'`)).rows[0].n === 1, o);
o = await handleSlackEvent(sdb, slack, ev('E2', { type: 'message', user: 'UTENG', text: 'Agree, bigger', ts: '17000.501', thread_ts: post.ts }), APP);
ok('a second reply adds feedback without a second DM', o === 'comment_saved' && posts().length === before + 1);
o = await handleSlackEvent(sdb, slack, ev('E3', { type: 'message', user: 'USTRANGER', text: 'hi', ts: '17000.502', thread_ts: post.ts }), APP);
ok('non-members are not attributed or saved', o === 'ignored_non_member');
o = await handleSlackEvent(sdb, slack, ev('E4', { type: 'message', user: 'UHENRY', text: 'unrelated', ts: '17000.503', thread_ts: '99999.1' }), APP);
ok('replies in other threads are ignored', o === 'not_a_review_thread');
o = await handleSlackEvent(sdb, slack, ev('E5', { type: 'message', user: 'UHENRY', text: 'top level', ts: '17000.504' }), APP);
ok('top-level channel messages are ignored', o === 'not_a_reply');

// edits, deletes
o = await handleSlackEvent(sdb, slack, ev('E6', { type: 'message', subtype: 'message_changed', message: { ts: '17000.500', text: 'At 0:03 the logo is too small' } }), APP);
let c = (await db.query(`select body, body_history, edited_at from comments where source_ref='CTEST0001:17000.500'`)).rows[0];
ok('an edit updates the comment and keeps the original', o === 'edited' && c.body === 'At 0:03 the logo is too small' && c.body_history[0].body === 'At 0:03 the logo is tiny' && c.edited_at);
o = await handleSlackEvent(sdb, slack, ev('E7', { type: 'message', subtype: 'message_deleted', deleted_ts: '17000.500' }), APP);
c = (await db.query(`select body, deleted_at from comments where source_ref='CTEST0001:17000.500'`)).rows[0];
ok('a delete is marked, review history kept', o === 'deleted' && c.deleted_at && c.body === 'At 0:03 the logo is too small');

// reactions
o = await handleSlackEvent(sdb, slack, ev('E8', { type: 'reaction_added', user: 'UHENRY', reaction: 'white_check_mark', item: { type: 'message', channel: 'CTEST0001', ts: post.ts } }), APP);
ok('a reaction is recorded as sentiment on the shared version', o === 'reaction_saved' && (await db.query(`select version_id, member_id from slack_reactions`)).rows[0].version_id === 'ast_t_v1');
ok('a reaction never approves', (await db.query(`select count(*)::int n from reviews`)).rows[0].n === 0);
o = await handleSlackEvent(sdb, slack, ev('E9', { type: 'reaction_removed', user: 'UHENRY', reaction: 'white_check_mark', item: { type: 'message', channel: 'CTEST0001', ts: post.ts } }), APP);
ok('removing a reaction is kept as history', o === 'reaction_removed' && (await db.query(`select removed_at from slack_reactions`)).rows[0].removed_at);

// nothing edited the ad
ok('Slack feedback never creates a version or starts processing', (await db.query(`select count(*)::int n from versions where asset_id='ast_t'`)).rows[0].n === 2
  && (await db.query(`select count(*)::int n from processing`)).rows[0].n === 0 && (await db.query(`select count(*)::int n from revision_jobs`)).rows[0].n === 0);

// transport: arguments must reach Slack on read methods (form-encoded), including private channel types and blocks
{ const seen = []; const fakeFetch = async (url, init) => { seen.push({ url, type: init.headers['content-type'], body: String(init.body) }); return { json: async () => ({ ok: true }) }; };
  const call = mod.slackApi('xoxb-test', fakeFetch);
  await call('users.conversations', { types: 'public_channel,private_channel', exclude_archived: true, limit: 200 });
  await call('chat.postMessage', { channel: 'C1', blocks: [{ type: 'section' }] });
  ok('read methods send form-encoded args (private channels included)', seen[0].type === 'application/x-www-form-urlencoded' && new URLSearchParams(seen[0].body).get('types') === 'public_channel,private_channel');
  ok('blocks are sent as JSON text inside the form', JSON.parse(new URLSearchParams(seen[1].body).get('blocks'))[0].type === 'section'); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
