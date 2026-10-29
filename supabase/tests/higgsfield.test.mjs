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
  new Function('require', 'module', 'exports', code)(id => id === './api' ? load('src/lib/server/api.ts') : id === './slack' ? load('src/lib/server/slack.ts') : require(id), m, m.exports);
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
let posts = [], state = 'queued', postStatus = 200;
const hf = async (url, init = {}) => {
  url = String(url);
  if (init.method === 'POST') { posts.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify(postStatus === 200 ? { request_id: 'req-' + posts.length, status: 'queued' } : { detail: 'Not enough credits' }), { status: postStatus }); }
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
ok('usage counts seconds requested this month (errors excluded)', u.seconds_this_month === 9 + 12 + 9 && u.monthly_cap_seconds === null, JSON.stringify(u));
process.env.HIGGSFIELD_MONTHLY_SECONDS = '35';
ok('optional monthly cap blocks before paying', (await rejects(generate(sdb, actor(SHANE), { prompt: 'x', idempotency_key: 'key-00000010' }, 'c', APP, hf)))?.status === 402 && posts.length === before);
delete process.env.HIGGSFIELD_MONTHLY_SECONDS;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
