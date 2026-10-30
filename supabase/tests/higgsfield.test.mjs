// Higgsfield generation (src/lib/server/higgsfield.ts) against every migration in PGlite with a fake Higgsfield.
// No network, no credits. Usage: node supabase/tests/higgsfield.test.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { pgClient } from './pgshim.mjs';

const here = import.meta.dirname; const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const cache = {};
function load(file) {
  if (cache[file]) return cache[file];
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} }; cache[file] = m.exports;
  new Function('require', 'module', 'exports', code)(id => id === './api' ? load('src/lib/server/api.ts') : id === './higgsfield' ? load('src/lib/server/higgsfield.ts') : id === './slack' ? load('src/lib/server/slack.ts') : require(id), m, m.exports);
  return Object.assign(cache[file], m.exports);
}
const { generate, refresh, usage, mp4Info } = load('src/lib/server/higgsfield.ts');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`); };
const rejects = async (p) => { try { await p; return null; } catch (e) { return e; } };

const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;`);
for (const f of readdirSync(path.join(here, '../migrations')).filter(f => f.endsWith('.sql')).sort())
  await db.exec(readFileSync(path.join(here, '../migrations', f), 'utf8').split('-- @supabase-only')[0].replace(/^alter publication.*$/gm, ''));
const SHANE = '00000000-0000-0000-0000-00000000000a', TENG = '00000000-0000-0000-0000-00000000000c', VIEW = '00000000-0000-0000-0000-0000000000dd';
await db.exec(`insert into role_grants values ('shane.wilson@yokegtm.com','admin'),('teng.he@yokegtm.com','creator'),('v@yokegtm.com','viewer');
  insert into auth.users(id,email) values ('${SHANE}','shane.wilson@yokegtm.com'),('${TENG}','teng.he@yokegtm.com'),('${VIEW}','v@yokegtm.com');`);
const roles = Object.fromEntries((await db.query(`select user_id, role from members`)).rows.map(r => [r.user_id, r.role]));
const actor = id => ({ user_id: id, role: roles[id] || 'creator', email: '', display_name: '' });
const sdb = pgClient(db);

// Minimal MP4: ftyp + moov(mvhd 9 s @ 1000, trak/tkhd 720x1280).
function mp4(sec = 9, w = 720, h = 1280) {
  const box = (t, body) => { const b = Buffer.alloc(8 + body.length); b.writeUInt32BE(8 + body.length); b.write(t, 4, 'latin1'); body.copy(b, 8); return b; };
  const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(sec * 1000, 16);
  const tkhd = Buffer.alloc(84); tkhd.writeUInt32BE(w * 65536, 76); tkhd.writeUInt32BE(h * 65536, 80);
  return Buffer.concat([box('ftyp', Buffer.from('isom0000isom')), box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', box('tkhd', tkhd))])), Buffer.alloc(2000)]);
}
const info = mp4Info(new Uint8Array(mp4()));
ok('reads duration and size from an MP4', info.duration === 9 && info.width === 720 && info.height === 1280, JSON.stringify(info));

// Fake Higgsfield
let posts = [], state = 'queued', postStatus = 200, postNoId = false;
const hf = async (url, init = {}) => {
  url = String(url);
  if (init.method === 'POST') { posts.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify(postStatus === 200 ? (postNoId ? { status: 'queued' } : { request_id: 'req-' + posts.length, status: 'queued' }) : { detail: postStatus >= 500 ? 'Upstream error' : 'Not enough credits' }), { status: postStatus }); }
  if (url.includes('/requests/')) return Response.json(state === 'completed' ? { status: 'completed', video: { url: 'https://cdn.example/out.mp4' } } : { status: state });
  if (url === 'https://cdn.example/out.mp4') return new Response(mp4());
  return new Response('?', { status: 404 });
};
const APP = 'https://studio.example';

// ---------- generate ----------
let r = await generate(sdb, actor(TENG), { prompt: 'A rep at a desk at night', idempotency_key: 'key-00000001', audio: true }, 'id:secret', APP, hf);
ok('defaults: 9 s, 720p, vertical 9:16, sound on request', posts[0].body.duration === 9 && posts[0].body.resolution === '720p' && posts[0].body.aspect_ratio === '9:16' && posts[0].body.generate_audio === true);
ok('Seedance 2.5 model, credentials only in the header', posts[0].url.startsWith('https://api.higgsfield.ai/bytedance/seedance-2.5/text-to-video?hf_webhook=') && posts[0].headers.authorization === 'Key id:secret' && !posts[0].url.includes('secret'));
ok('webhook points at this app with the job id', decodeURIComponent(posts[0].url).includes(`${APP}/api/higgsfield/webhook?job=${r.job.id}`));
const asset = (await db.query(`select * from assets where id = $1`, [r.asset_id])).rows[0];
ok('new ad is owned by whoever pressed Generate', asset.owner_id === TENG && asset.kind === 'video');
let ver = (await db.query(`select * from versions where id = $1`, [r.version_id])).rows[0];
ok('a Rendering version appears right away', ver.file_path === null && ver.render.state === 'rendering' && ver.version === 1);
ok('job is submitted with Higgsfield’s request id', r.job.status === 'submitted' && r.job.request_id === 'req-1');

const again = await generate(sdb, actor(TENG), { prompt: 'A rep at a desk at night', idempotency_key: 'key-00000001', audio: true }, 'id:secret', APP, hf);
ok('same press again never submits twice', posts.length === 1 && again.repeated && again.version_id === r.version_id);
ok('reusing another owner’s key cannot return their job', (await rejects(generate(sdb, { ...actor(TENG), user_id: '00000000-0000-0000-0000-0000000000ee' }, { prompt: 'A rep at a desk at night', idempotency_key: 'key-00000001', audio: true }, 'c', APP, hf)))?.status === 403);
ok('changed settings with an old key are a conflict', (await rejects(generate(sdb, actor(TENG), { prompt: 'Different scene', idempotency_key: 'key-00000001', audio: true }, 'c', APP, hf)))?.status === 409 && posts.length === 1);
ok('provider submission includes its own stable idempotency key', posts[0].headers['Idempotency-Key'] === r.job.id);

ok('13 s is refused (max 12)', (await rejects(generate(sdb, actor(TENG), { prompt: 'x', duration: 13, idempotency_key: 'key-00000002' }, 'c', APP, hf)))?.status === 400 && posts.length === 1);
ok('3 s is refused (min 4)', (await rejects(generate(sdb, actor(TENG), { prompt: 'x', duration: 3, idempotency_key: 'key-00000003' }, 'c', APP, hf)))?.status === 400);
ok('viewers cannot generate', (await rejects(generate(sdb, actor(VIEW), { prompt: 'x', idempotency_key: 'key-00000004' }, 'c', APP, hf)))?.status === 403 && posts.length === 1);
ok('a creator cannot add a version to someone else’s ad', (await rejects(generate(sdb, actor(VIEW === TENG ? SHANE : TENG), { asset_id: (await db.query(`insert into assets(concept_name,kind,format,owner_id,created_by) values ('Shane','video','vertical','${SHANE}','${SHANE}') returning id`)).rows[0].id, prompt: 'x', idempotency_key: 'key-00000005' }, 'c', APP, hf)))?.status === 403 && posts.length === 1);

// ---------- status ----------
let j = await refresh(sdb, r.job.id, 'id:secret', hf);
ok('still rendering: nothing changes', j.status === 'submitted' && (await db.query(`select file_path from versions where id=$1`, [r.version_id])).rows[0].file_path === null);
state = 'completed';
j = await refresh(sdb, r.job.id, 'id:secret', hf);
ver = (await db.query(`select * from versions where id = $1`, [r.version_id])).rows[0];
ok('finished: the same version gets the real MP4', j.status === 'completed' && ver.file_path?.endsWith('.mp4') && ver.content_type === 'video/mp4' && ver.render.state === 'ready');
ok('duration, size and checksum recorded', Number(ver.duration_sec) === 9 && ver.width === 720 && ver.height === 1280 && ver.sha256?.length === 64 && Number(ver.size_bytes) > 2000);
ok('file stored in the ad’s folder', sdb.objects.has(ver.file_path) && ver.file_path.startsWith(r.asset_id + '/'));
const n = sdb.objects.size; await refresh(sdb, r.job.id, 'id:secret', hf);
ok('checking again does nothing (no second upload)', sdb.objects.size === n);
ok('the finished version is now immutable', !!(await rejects(db.exec(`update versions set file_path='x.mp4' where id='${r.version_id}'`))));

// ---------- new version on the same ad ----------
state = 'queued';
const r2 = await generate(sdb, actor(TENG), { asset_id: r.asset_id, prompt: 'Same, but morning light', duration: 12, idempotency_key: 'key-00000006' }, 'c', APP, hf);
ok('owner can make v2 on their ad; 12 s allowed; sound off by default', r2.asset_id === r.asset_id && posts.at(-1).body.duration === 12 && posts.at(-1).body.generate_audio === false
  && (await db.query(`select version from versions where id=$1`, [r2.version_id])).rows[0].version === 2);

// ---------- moderation / failure ----------
state = 'nsfw'; j = await refresh(sdb, r2.job.id, 'c', hf);
ver = (await db.query(`select * from versions where id = $1`, [r2.version_id])).rows[0];
ok('moderated: shown as failed with the reason, no file, not called a success', j.status === 'nsfw' && ver.file_path === null && ver.render.state === 'failed' && /moderation/.test(ver.render.note));
state = 'failed';
const r3 = await generate(sdb, actor(SHANE), { prompt: 'x', format: 'landscape', idempotency_key: 'key-00000007' }, 'c', APP, hf);
ok('landscape maps to 16:9', posts.at(-1).body.aspect_ratio === '16:9');
j = await refresh(sdb, r3.job.id, 'c', hf);
ok('failed render is marked failed', j.status === 'failed' && (await db.query(`select render->>'state' s from versions where id=$1`, [r3.version_id])).rows[0].s === 'failed');

postStatus = 402;
const e4 = await rejects(generate(sdb, actor(SHANE), { prompt: 'x', idempotency_key: 'key-00000008' }, 'c', APP, hf));
const j4 = (await db.query(`select j.status, v.render->>'state' s from higgsfield_jobs j join versions v on v.id=j.version_id where j.idempotency_key='key-00000008'`)).rows[0];
ok('out of credits: clear error, version marked failed', e4?.status === 402 && /credits/.test(e4.message) && j4.status === 'error' && j4.s === 'failed');
postStatus = 200;
const hang = async (url, init) => { if (init?.method === 'POST') throw new Error('timeout'); return hf(url, init); };
const before = posts.length;
const e5 = await rejects(generate(sdb, actor(SHANE), { prompt: 'x', idempotency_key: 'key-00000009' }, 'c', APP, hang));
ok('no answer: reported as unknown outcome, not retried', e5?.code === 'timeout_unknown_outcome' && posts.length === before);

// ---------- usage + cap ----------
const u = await usage(sdb);
ok('an unknown submission keeps its budget reservation and can be inspected', (await db.query(`select status, error from higgsfield_jobs where idempotency_key='key-00000009'`)).rows[0].status === 'submitting');
ok('usage includes unknown outcomes (definite errors excluded)', u.seconds_this_month === 9 + 12 + 9 + 9 && u.monthly_cap_seconds === null, JSON.stringify(u));
process.env.HIGGSFIELD_MONTHLY_SECONDS = '35';
ok('optional monthly cap blocks before paying', (await rejects(generate(sdb, actor(SHANE), { prompt: 'x', idempotency_key: 'key-00000010' }, 'c', APP, hf)))?.status === 402 && posts.length === before);
delete process.env.HIGGSFIELD_MONTHLY_SECONDS;

// ---------- saving a completed render must survive interrupted writes ----------
state = 'completed';
const recover = await generate(sdb, actor(TENG), { prompt: 'A repairable render', idempotency_key: 'recovery-000001' }, 'c', APP, hf);
let failVersionWrite = true;
const flaky = { ...sdb, from: table => {
  const b = sdb.from(table), update = b.update;
  b.update = row => {
    if (table === 'versions' && row.file_path && failVersionWrite) {
      failVersionWrite = false;
      b.then = resolve => Promise.resolve({ data: null, error: { message: 'Temporary database write failure' } }).then(resolve);
    }
    return update(row);
  };
  return b;
} };
const interrupted = await rejects(refresh(flaky, recover.job.id, 'c', hf));
let interruptedJob = (await db.query(`select status from higgsfield_jobs where id=$1`, [recover.job.id])).rows[0];
ok('failed version write cannot mark the job complete', interrupted && interruptedJob.status === 'submitted' && (await db.query(`select file_path from versions where id=$1`, [recover.version_id])).rows[0].file_path === null);
const afterUpload = sdb.objects.size;
const recovered = await refresh(sdb, recover.job.id, 'c', hf);
ok('retry reuses the uploaded bytes and finishes the version without generating again', recovered.status === 'completed' && sdb.objects.size === afterUpload && (await db.query(`select render->>'state' s from versions where id=$1`, [recover.version_id])).rows[0].s === 'ready');
await db.query(`update higgsfield_jobs set status='submitted' where id=$1`, [recover.job.id]);
const repaired = await refresh(sdb, recover.job.id, 'c', async () => { throw new Error('Provider must not be called again'); });
ok('saved video repairs a lost job acknowledgement without contacting the provider', repaired.status === 'completed');

const concurrent = await generate(sdb, actor(TENG), { prompt: 'One file for two pollers', idempotency_key: 'recovery-000002' }, 'c', APP, hf);
const countBeforePolls = sdb.objects.size;
const two = await Promise.all([refresh(sdb, concurrent.job.id, 'c', hf), refresh(sdb, concurrent.job.id, 'c', hf)]);
ok('concurrent completion checks store exactly one video and both finish', two.every(j => j.status === 'completed') && sdb.objects.size === countBeforePolls + 1);
const legacy = await generate(sdb, actor(TENG), { prompt: 'Recover an old premature completion', idempotency_key: 'recovery-000003' }, 'c', APP, hf);
await db.query(`update higgsfield_jobs set status='completed' where id=$1`, [legacy.job.id]);
ok('legacy jobs marked complete before saving can still recover', (await refresh(sdb, legacy.job.id, 'c', hf)).status === 'completed' && (await db.query(`select file_path from versions where id=$1`, [legacy.version_id])).rows[0].file_path);
ok('a truncated MP4 extended box header is safely ignored', mp4Info(new Uint8Array([0,0,0,1,102,116,121,112])).width === null);

// ---------- Claude's token API (/api/v1/higgsfield/*): same generate, same limits ----------
{
  const { handle } = load('src/lib/server/api.ts');
  const realFetch = globalThis.fetch; globalThis.fetch = hf; process.env.HF_CREDENTIALS = 'id:secret'; state = 'queued'; postStatus = 200;
  const q = (s = '') => new URLSearchParams(s);
  try {
    const before = posts.length;
    const g = await handle(sdb, actor(TENG), 'POST', ['higgsfield', 'generate'], { prompt: 'A rep ignores a pile of sticky notes', duration: 6, format: 'square', audio: false, concept_name: 'Sticky notes', idempotency_key: 'hf-api-00000001' }, q(), APP);
    const last = posts[posts.length - 1];
    ok('API: one submit, settings passed through', posts.length === before + 1 && last.body.duration === 6 && last.body.aspect_ratio === '1:1' && last.body.generate_audio === false && !!g.job_id && g.link.startsWith(`${APP}/a/${g.asset_id}?v=`));
    const g2 = await handle(sdb, actor(TENG), 'POST', ['higgsfield', 'generate'], { prompt: 'A rep ignores a pile of sticky notes', duration: 6, format: 'square', audio: false, concept_name: 'Sticky notes', idempotency_key: 'hf-api-00000001' }, q(), APP);
    ok('API: same key never submits twice', posts.length === before + 1 && g2.repeated && g2.job_id === g.job_id);
    ok('API: viewers cannot generate', (await rejects(handle(sdb, actor(VIEW), 'POST', ['higgsfield', 'generate'], { prompt: 'x', idempotency_key: 'hf-api-00000002' }, q(), APP)))?.status === 403 && posts.length === before + 1);
    const u = await handle(sdb, actor(VIEW), 'GET', ['higgsfield', 'usage'], null, q(), APP);
    ok('API: usage shows seconds and allowed lengths', typeof u.seconds_this_month === 'number' && u.default_seconds === 9 && u.max_seconds === 12);
    const s = await handle(sdb, actor(TENG), 'GET', ['higgsfield', 'status'], null, q('job=' + g.job_id), APP);
    ok('API: status returns the job and its link', s.status === 'submitted' && s.version_id === g.version_id && s.link.includes(g.asset_id));
    ok('API: bad job id refused', (await rejects(handle(sdb, actor(TENG), 'GET', ['higgsfield', 'status'], null, q('job=nope'), APP)))?.status === 400);
    delete process.env.HF_CREDENTIALS;
    ok('API: no server key -> higgsfield_not_connected, nothing sent', (await rejects(handle(sdb, actor(TENG), 'POST', ['higgsfield', 'generate'], { prompt: 'x', idempotency_key: 'hf-api-00000003' }, q(), APP)))?.code === 'higgsfield_not_connected' && posts.length === before + 1);
  } finally { globalThis.fetch = realFetch; delete process.env.HF_CREDENTIALS; }
}

// ---------- Regenerate a Higgsfield ad from approved feedback (frozen snapshot, same parent, applied only after save) ----------
{
  const { startHiggsfieldRevision, revisionPrompt } = load('src/lib/server/higgsfield.ts');
  const HENRY = '00000000-0000-0000-0000-0000000000ee';
  await db.exec(`insert into role_grants values ('henry2@yokegtm.com','creator'); insert into auth.users(id,email) values ('${HENRY}','henry2@yokegtm.com');`);
  state = 'queued'; postStatus = 200; postNoId = false;
  const row = async (t, id) => (await db.query(`select * from ${t} where id = $1`, [id])).rows[0];
  const comment = async (assetId, versionId, author, body, at = null) => (await db.query(`insert into comments(asset_id, version_id, author, body, at_sec) values ($1,$2,$3,$4,$5) returning id`, [assetId, versionId, author, body, at])).rows[0].id;
  const approve = async id => { const r = await sdb.rpc('feedback_decide', { p_comment: id, p_decision: 'approved', p_actor: TENG }); if (r.error) throw new Error(r.error.message); };
  const finished = async (prompt, format, key, extra = {}) => { const g = await generate(sdb, actor(TENG), { prompt, format, duration: 5, audio: false, idempotency_key: key, ...extra }, 'c', APP, hf); state = 'completed'; await refresh(sdb, g.job.id, 'c', hf); state = 'queued'; return g; };

  // Format comes from the ad, never a silent 9:16.
  const feed = await finished('Rain on a sales floor', 'feed45', 'rev-base-000001');
  const feedV = await row('versions', feed.version_id);
  ok('feed preset renders a true 3:4 frame and stores the real size', posts.at(-1).body.aspect_ratio === '3:4' && feedV.width === 720 && feedV.render.state === 'ready');
  let before = posts.length;
  const more = await generate(sdb, actor(TENG), { asset_id: feed.asset_id, prompt: 'Rain, take two', duration: 5, idempotency_key: 'rev-fmt-0000001' }, 'c', APP, hf);
  ok('a new version on a feed ad keeps 3:4 when format is omitted', posts.length === before + 1 && posts.at(-1).body.aspect_ratio === '3:4');
  ok('asking for 9:16 on a feed ad is refused, nothing sent', (await rejects(generate(sdb, actor(TENG), { asset_id: feed.asset_id, prompt: 'x', format: 'vertical', idempotency_key: 'rev-fmt-0000002' }, 'c', APP, hf)))?.status === 400 && posts.length === before + 1);
  state = 'completed'; await refresh(sdb, more.job.id, 'c', hf); state = 'queued';

  // Approved feedback on the latest version, then Regenerate.
  const c1 = await comment(feed.asset_id, more.version_id, HENRY, 'Make the rain heavier', 2);
  const c2 = await comment(feed.asset_id, more.version_id, HENRY, 'Not approved, should be ignored');
  await approve(c1);
  ok('only the owner or an admin can regenerate', (await rejects(startHiggsfieldRevision(sdb, actor(HENRY), feed.asset_id, null, 'c', APP, hf)))?.status === 403);
  before = posts.length;
  const rv = await startHiggsfieldRevision(sdb, actor(TENG), feed.asset_id, 'Keep the desk lamp', 'c', APP, hf);
  const sent = posts.at(-1).body;
  ok('one paid submit with the parent\'s length, frame and sound', posts.length === before + 1 && sent.duration === 5 && sent.aspect_ratio === '3:4' && sent.generate_audio === false);
  ok('prompt = parent prompt + approved items + owner note only', sent.prompt.startsWith('Rain, take two') && sent.prompt.includes('Make the rain heavier (at 2s)') && sent.prompt.includes('Keep the desk lamp') && !sent.prompt.includes('should be ignored'));
  const proc = await row('processing', rv.processing_id);
  ok('processing is a Higgsfield run on the exact reviewed version', proc.engine === 'higgsfield' && proc.status === 'executing' && proc.reviewed_version_id === more.version_id);
  const nv = await row('versions', rv.version_id);
  ok('new version links its parent and processing', nv.parent_version_id === more.version_id && nv.source.processing_id === rv.processing_id && nv.render.state === 'rendering');
  ok('feedback is NOT applied on submit', (await row('comments', c1)).status === 'open');
  // A Slack edit while rendering must not change what was approved.
  await db.query(`update comments set body = 'Make it sunny instead', edited_at = now() where id = $1`, [c1]);
  const snap = (await row('processing', rv.processing_id)).feedback_snapshot;
  ok('approved text and attribution are frozen', snap.length === 1 && snap[0].body === 'Make the rain heavier' && snap[0].author === HENRY && snap[0].comment_id === c1 && snap[0].at_sec === 2);
  ok('approve/reject is locked while it renders', !!(await sdb.rpc('feedback_decide', { p_comment: c1, p_decision: 'rejected', p_actor: TENG })).error);
  before = posts.length;
  const again = await startHiggsfieldRevision(sdb, actor(TENG), feed.asset_id, 'Keep the desk lamp', 'c', APP, hf);
  ok('pressing Regenerate again returns the same render, nothing paid twice', again.repeated && again.job.id === rv.job.id && posts.length === before);
  state = 'completed'; await refresh(sdb, rv.job.id, 'c', hf); state = 'queued';
  const doneP = await row('processing', rv.processing_id), doneC = await row('comments', c1);
  ok('after the playable video is stored: feedback applied in the new version, processing done', doneP.status === 'done' && doneP.result_version_id === rv.version_id && doneC.status === 'applied' && doneC.applied_in === rv.version_id && (await row('versions', rv.version_id)).file_path);
  ok('unapproved feedback is untouched', (await row('comments', c2)).status === 'open');
  ok('a second poll after completion changes nothing', (await refresh(sdb, rv.job.id, 'c', hf)).status === 'completed' && (await row('processing', rv.processing_id)).rev === doneP.rev);

  // Definite refusal: processing failed, feedback stays approved for a later try.
  const c3 = await comment(feed.asset_id, rv.version_id, HENRY, 'Slower ending'); await approve(c3);
  postStatus = 402;
  const refused = await rejects(startHiggsfieldRevision(sdb, actor(TENG), feed.asset_id, null, 'c', APP, hf));
  postStatus = 200;
  const failedP = (await db.query(`select * from processing where asset_id = $1 order by created_at desc limit 1`, [feed.asset_id])).rows[0];
  ok('refused render: processing failed, feedback still approved and open', refused?.code === 'higgsfield_refused' && failedP.status === 'failed' && (await row('comments', c3)).status === 'open' && (await row('comments', c3)).decision === 'approved');

  // Ambiguous outcomes keep the job and reservation; no automatic paid retry.
  const usedBefore = (await usage(sdb)).seconds_this_month;
  postStatus = 503;
  const amb = await rejects(startHiggsfieldRevision(sdb, actor(TENG), feed.asset_id, null, 'c', APP, hf));
  postStatus = 200;
  const ambP = (await db.query(`select * from processing where asset_id = $1 order by created_at desc limit 1`, [feed.asset_id])).rows[0];
  const ambJ = (await db.query(`select * from higgsfield_jobs where processing_id = $1`, [ambP.id])).rows[0];
  ok('HTTP 5xx is an unknown outcome, not a refusal', amb?.code === 'unknown_outcome' && ambJ.status === 'submitting' && /unknown/i.test(ambJ.error));
  ok('unknown outcome keeps the usage reservation and the processing open', (await usage(sdb)).seconds_this_month === usedBefore + 5 && ambP.status === 'executing' && /unclear/.test(ambP.message));
  ok('unknown outcome never applies feedback', (await row('comments', c3)).status === 'open');
  ok('a retry after a failed render builds on the last real version, not the failed placeholder', ambJ.parent_version_id === rv.version_id && ambP.reviewed_version_id === rv.version_id);
  before = posts.length;
  const ambAgain = await startHiggsfieldRevision(sdb, actor(TENG), feed.asset_id, null, 'c', APP, hf);
  ok('pressing again after an unknown outcome does not pay again', ambAgain.repeated && posts.length === before);
  postNoId = true;
  const noId = await rejects(generate(sdb, actor(TENG), { prompt: 'No id please', format: 'square', duration: 4, idempotency_key: 'rev-noid-000001' }, 'c', APP, hf));
  postNoId = false;
  const noIdJ = (await db.query(`select * from higgsfield_jobs where idempotency_key = 'rev-noid-000001'`)).rows[0];
  ok('2xx without a request id is an unknown outcome; version stays Rendering, not failed', noId?.code === 'unknown_outcome' && noIdJ.status === 'submitting' && (await row('versions', noIdJ.version_id)).render.state === 'rendering');

  // Double click / two tabs: both callers get the same executing row before any job exists.
  {
    const dc = await finished('Double click ad', 'vertical', 'rev-dbl-0000001');
    const cd = await comment(dc.asset_id, dc.version_id, HENRY, 'Add a coffee cup'); await approve(cd);
    let gate; const held = new Promise(r => { gate = r; });
    const slow = async (url, init) => { if (init?.method === 'POST') await held; return hf(url, init); };
    before = posts.length;
    const both = Promise.allSettled([startHiggsfieldRevision(sdb, actor(TENG), dc.asset_id, null, 'c', APP, slow), startHiggsfieldRevision(sdb, actor(SHANE), dc.asset_id, null, 'c', APP, slow)]);
    await new Promise(r => setTimeout(r, 50)); gate();
    const [a1, a2] = await both;
    const runs = (await db.query(`select * from processing where asset_id = $1 and engine = 'higgsfield'`, [dc.asset_id])).rows;
    const jobs = (await db.query(`select * from higgsfield_jobs where asset_id = $1 and processing_id is not null`, [dc.asset_id])).rows;
    ok('double click: one processing row, one job, one paid submit', runs.length === 1 && jobs.length === 1 && posts.length === before + 1);
    ok('double click: neither caller errors; one is told it is already starting', a1.status === 'fulfilled' && a2.status === 'fulfilled' && [a1.value, a2.value].filter(x => x.repeated).length === 1, `${a1.reason?.message || ''} ${a2.reason?.message || ''}`);
    ok('double click: the losing caller never marks the winning run failed', runs[0].status === 'executing');
    state = 'completed'; await refresh(sdb, jobs[0].id, 'c', hf); state = 'queued';
    ok('double click: the winning render completes and applies the feedback', (await row('processing', runs[0].id)).status === 'done' && (await row('comments', cd)).status === 'applied');
  }
  // A claim whose holder died before inserting its job can be reclaimed, but only once and only when stale.
  {
    const sc = await finished('Stale claim ad', 'vertical', 'rev-stale-000001');
    const cs = await comment(sc.asset_id, sc.version_id, HENRY, 'Brighter'); await approve(cs);
    const p0 = (await sdb.rpc('higgsfield_revision_start', { p_asset: sc.asset_id, p_note: null, p_actor: TENG })).data;
    const claim = async () => (await sdb.rpc('higgsfield_revision_claim', { p_processing: p0.id })).data;
    ok('claim: first caller wins, second loses', (await claim()) === true && (await claim()) === false);
    await db.query(`update processing set render_claimed_at = now() - interval '5 minutes' where id = $1`, [p0.id]);
    const [r1, r2] = await Promise.all([claim(), claim()]);
    ok('claim: a stale claim with no job is reclaimed by exactly one caller', [r1, r2].filter(Boolean).length === 1);
    before = posts.length;
    const resumed = await startHiggsfieldRevision(sdb, actor(TENG), sc.asset_id, null, 'c', APP, hf);
    ok('claim: a fresh claim held by someone else means "already starting", nothing paid', resumed.repeated && resumed.job === null && posts.length === before);
    const { handle } = load('src/lib/server/api.ts'); process.env.HF_CREDENTIALS = 'c';
    const viaApi = await handle(sdb, actor(TENG), 'POST', ['higgsfield', 'revise'], { asset_id: sc.asset_id, person_confirmed: true }, new URLSearchParams(), APP);
    delete process.env.HF_CREDENTIALS;
    ok('claim: the API reports "starting" (no crash, no job id) while another caller holds the claim', viaApi.status === 'starting' && viaApi.job_id === null && viaApi.repeated && posts.length === before);
    await db.query(`update processing set render_claimed_at = now() - interval '5 minutes' where id = $1`, [p0.id]);
    const taken = await startHiggsfieldRevision(sdb, actor(TENG), sc.asset_id, null, 'c', APP, hf);
    ok('claim: after the holder died, the next press renders once', !taken.repeated && posts.length === before + 1 && taken.processing_id === p0.id);
    await db.query(`update processing set render_claimed_at = now() - interval '5 minutes' where id = $1`, [p0.id]);
    ok('claim: never reclaimable once a job exists', (await claim()) === false);
  }

  // The general (worker) Regenerate also freezes text and attribution.
  const w = await finished('Worker path ad', 'square', 'rev-work-000001');
  const c4 = await comment(w.asset_id, w.version_id, HENRY, 'Bigger logo'); await approve(c4);
  const wp = (await sdb.rpc('feedback_process', { p_asset: w.asset_id, p_note: null, p_actor: TENG })).data;
  ok('Regenerate (worker) stores a frozen snapshot too', wp.feedback_snapshot?.[0]?.body === 'Bigger logo' && wp.feedback_snapshot[0].author === HENRY && wp.engine === 'worker');
  ok('regenerate start is server-only (not callable from the Data API)', !!(await rejects(db.exec(`select set_config('request.jwt.claims','{"sub":"${TENG}","role":"authenticated"}',false); set role authenticated; select public.higgsfield_revision_start('${w.asset_id}', null, null);`))));
  await db.exec(`reset role; select set_config('request.jwt.claims','',false)`);
  ok('voice-only feedback cannot steer a render on its own', !!(await rejects(Promise.resolve().then(() => revisionPrompt('p', [{ body: 'Voice note' }], null)))));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
