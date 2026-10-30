// End-to-end: the skill's helper script (skills/yoke-ad-maker/scripts/adstudio.py) -> HTTP -> the real API handler
// -> every migration in PGlite. Storage is a local stand-in that receives the actual uploaded bytes.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);
import { createHash } from 'node:crypto';
import http from 'node:http'; import os from 'node:os'; import path from 'node:path';
import ts from 'typescript';
import { pgClient } from './pgshim.mjs';

const here = import.meta.dirname; const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const modules = {};
function load(file) {
  if (modules[file]) return modules[file];
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} }; modules[file] = m.exports;
  new Function('require', 'module', 'exports', code)(id => ['./slack', './api', './higgsfield'].includes(id) ? load(`src/lib/server/${id.slice(2)}.ts`) : require(id), m, m.exports);
  return Object.assign(modules[file], m.exports);
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
  const sql = readFileSync(path.join(here, '../migrations', f), 'utf8'); await db.exec(sql.split('-- @supabase-only')[0].replace(/^alter publication.*$/gm, ''));
}
const TENG = '00000000-0000-0000-0000-00000000000c', HENRY = '00000000-0000-0000-0000-0000000000cc';
await db.exec(`insert into auth.users(id,email) values ('${TENG}','teng.he@yokegtm.com'),('${HENRY}','henry@yokegtm.com');`);
const tokenFor = async uid => { const r = await db.exec(`select set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',false); select token from api_token_create('t');`); await db.exec(`select set_config('request.jwt.claims','',false)`); return r[1].rows[0].token; };
const T = { teng: await tokenFor(TENG), henry: await tokenFor(HENRY) };

const sdb = pgClient(db); const bytes = new Map();
let port;
sdb.storage.from = () => ({
  upload: async (p, buf, o) => { if (bytes.has(p)) return { data: null, error: { message: 'exists' } }; bytes.set(p, { buf: Buffer.from(buf), type: o.contentType }); return { data: { path: p }, error: null }; },
  download: async p => { const v = bytes.get(p); return v ? { data: new Blob([v.buf], { type: v.type }), error: null } : { data: null, error: { message: 'not found' } }; },
  createSignedUrl: async p => ({ data: { signedUrl: `http://127.0.0.1:${port}/storage/${p}` }, error: null }),
  createSignedUrls: async ps => ({ data: ps.map(p => ({ path: p, signedUrl: `http://127.0.0.1:${port}/storage/${p}` })), error: null }),
  createSignedUploadUrl: async p => ({ data: { signedUrl: `http://127.0.0.1:${port}/upload/${p}`, path: p, token: 't' }, error: null }),
  list: async (folder, o) => ({ data: [...bytes.entries()].filter(([k]) => k === folder + '/' + o.search).map(([k, v]) => ({ name: k.split('/').pop(), metadata: { size: v.buf.length, mimetype: v.type } })), error: null }),
});
const srv = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks);
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/upload/') && req.method === 'PUT') { const p = decodeURIComponent(u.pathname.slice(8)); if (bytes.has(p)) { res.writeHead(409).end(); return; } bytes.set(p, { buf: raw, type: req.headers['content-type'] }); res.writeHead(200).end('{}'); return; }
  if (u.pathname.startsWith('/storage/')) { const v = bytes.get(decodeURIComponent(u.pathname.slice(9))); if (!v) { res.writeHead(404).end(); return; } res.writeHead(200, { 'content-type': v.type }).end(v.buf); return; }
  if (u.pathname.startsWith('/api/v1/')) {
    try {
      const a = await authenticate(sdb, req.headers.authorization || null);
      const data = await handle(sdb, a, req.method, u.pathname.slice(8).split('/').filter(Boolean), raw.length ? JSON.parse(raw) : null, u.searchParams, 'https://studio.example');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    } catch (e) { const s = e instanceof ApiError ? e.status : 500; res.writeHead(s, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.code || 'error', message: e.message })); }
    return;
  }
  res.writeHead(404).end();
});
await new Promise(r => srv.listen(0, '127.0.0.1', r)); port = srv.address().port;

const script = path.join(root, 'skills/yoke-ad-maker/scripts/adstudio.py');
const run = async (who, args) => { // each call is a separate process: like a fresh Claude conversation with no memory
  try { const { stdout } = await execFileP('python3', [script, ...args], { env: { ...process.env, AD_STUDIO_API: `http://127.0.0.1:${port}/api/v1`, AD_STUDIO_TOKEN: T[who] }, encoding: 'utf8' }); return { code: 0, out: JSON.parse(stdout) }; }
  catch (e) { return { code: e.code, out: JSON.parse(e.stdout || '{}') }; }
};

// real media from this repo's clay renders (fallback: generate small files)
const tmp = mkdtempSync(path.join(os.tmpdir(), 'skill-'));
const png = path.join(tmp, 'static.png'), mp4 = path.join(tmp, 'motion.mp4'), poster = path.join(tmp, 'poster.jpg'), src = path.join(tmp, 'source.html'), webm = path.join(tmp, 'clip.mp4');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xF7F4EC:s=1080x1350', '-frames:v', '1', png]);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=1080x1920:d=2:r=30', '-pix_fmt', 'yuv420p', mp4]);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=1080x1920:d=1:r=30', '-c:v', 'libvpx', '-f', 'webm', webm]);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', mp4, '-frames:v', '1', poster]);
writeFileSync(src, '<!doctype html><canvas id=c></canvas><script>/* editable timeline */</script>');
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');

let r = (await run('teng', ['create', '--name', 'Follow-ups live in your head', '--kind', 'static', '--format', 'feed45']));
const S = r.out.id; ok('create a static ad', r.code === 0 && S);
r = (await run('teng', ['save', S, '--file', png, '--source', src, '--meta', JSON.stringify({ copy: { headline: 'Your follow-up strategy is remembering.' }, source: { tool: 'Claude', concept: 'memory' } })]));
ok('save real PNG bytes + editable source', r.code === 0 && r.out.id === `${S}_v1` && r.out.uploaded[png].sha256 === sha(png), JSON.stringify(r.out).slice(0, 200));
const stored = [...bytes.entries()].find(([k]) => k.startsWith(S + '/') && k.endsWith('.png'));
ok('the stored bytes are exactly the file', stored && createHash('sha256').update(stored[1].buf).digest('hex') === sha(png) && stored[1].type === 'image/png');
r = (await run('teng', ['save', S, '--file', png, '--source', src, '--meta', '{}']));
ok('re-running the same save does not duplicate the version', r.code === 0 && r.out.id === `${S}_v1` && r.out.duplicate === true);

r = (await run('teng', ['create', '--name', 'Follow-ups motion', '--kind', 'motion', '--format', 'vertical']));
const M = r.out.id;
r = (await run('teng', ['save', M, '--file', mp4, '--poster', poster, '--source', src, '--meta', JSON.stringify({ duration_sec: 2, width: 1080, height: 1920 })]));
ok('save a real MP4 with poster and timeline source', r.code === 0 && r.out.uploaded[mp4].content_type === 'video/mp4' && r.out.uploaded[poster].content_type === 'image/jpeg');
r = (await run('teng', ['save', M, '--file', webm, '--meta', '{}', '--key', 'webm-test']));
ok('a WebM named .mp4 is sent as video/webm, not renamed', r.code === 0 && r.out.uploaded[webm].content_type === 'video/webm');

// fresh conversation: retrieve everything by id
r = (await run('teng', ['get', M]));
const mv1 = r.out.versions.find(v => v.version === 1);
const fetched = Buffer.from(await (await fetch(mv1.file_url)).arrayBuffer());
ok('a fresh conversation retrieves the video, poster and source', createHash('sha256').update(fetched).digest('hex') === sha(mp4) && mv1.poster_url && mv1.editable_url && mv1.content_type === 'video/mp4');

// The actual Python Higgsfield commands cross HTTP and the real handler; only the paid provider is replaced.
const realFetch = globalThis.fetch;
let hfSubmits = 0;
process.env.HF_CREDENTIALS = 'test-only-no-live-provider';
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.higgsfield.ai/')) {
    if (init?.method === 'POST') { hfSubmits++; return Response.json({ request_id: 'fake-generation-request', status: 'queued' }); }
    return Response.json({ status: 'completed', video: { url: 'https://fake-higgsfield.example/video.mp4' } });
  }
  if (String(url) === 'https://fake-higgsfield.example/video.mp4') return new Response(readFileSync(mp4));
  return realFetch(url, init);
};
try {
  const g = await run('teng', ['higgsfield', '--prompt', 'A rep putting away sticky notes', '--seconds', '4', '--wait', '0', '--key', 'hf-helper-e2e-001']);
  ok('Higgsfield helper authenticates, submits through the server and returns a real asset link', g.code === 0 && g.out.job_id && g.out.link.includes(g.out.asset_id) && hfSubmits === 1);
  const repeated = await run('teng', ['higgsfield', '--prompt', 'A rep putting away sticky notes', '--seconds', '4', '--wait', '0', '--key', 'hf-helper-e2e-001']);
  ok('a repeated helper invocation does not resubmit to Higgsfield', repeated.out.job_id === g.out.job_id && hfSubmits === 1);
  const finished = await run('teng', ['hf-status', g.out.job_id]);
  const context = await run('teng', ['get', g.out.asset_id]);
  const media = context.out.versions[0];
  const actual = Buffer.from(await (await realFetch(media.file_url)).arrayBuffer());
  ok('Higgsfield status saves the provider video bytes into the shared library', finished.code === 0 && finished.out.status === 'completed' && media.render.state === 'ready' && createHash('sha256').update(actual).digest('hex') === sha(mp4));
} finally { globalThis.fetch = realFetch; delete process.env.HF_CREDENTIALS; }

// another member
r = (await run('henry', ['save', S, '--file', png, '--meta', '{}']));
ok('Henry’s Claude cannot save onto Teng’s ad', r.code === 1 && r.out.status === 403);
r = (await run('henry', ['comment', S, '--version', `${S}_v1`, '--text', 'Shorter headline please']));
ok('Henry’s Claude can comment', r.code === 0);
r = (await run('henry', ['process', S]));
ok('Henry’s Claude cannot process Teng’s feedback', r.code === 1 && r.out.status === 403);
r = (await run('teng', ['inbox']));
ok('Teng’s Claude sees the pending feedback at wrap-up', r.out.items?.[0]?.asset_id === S && r.out.items[0].pending === 1);
ok('Henry’s inbox is empty', (await run('henry', ['inbox'])).out.items.length === 0);

// process in Claude, explicit approval, save, complete
let p = (await run('teng', ['process', S])).out;
const cid = (await run('teng', ['get', S])).out.comments[0].id;
p = (await run('teng', ['propose', p.id, '--rev', String(p.rev), '--json', JSON.stringify({ summary: 'One headline change', items: [{ comment_ids: [cid], kind: 'compatible', change: 'Cut headline to 5 words' }] })])).out;
p = (await run('teng', ['approve', p.id, '--rev', String(p.rev), '--decisions', JSON.stringify([{ comment_id: cid, decision: 'apply' }]), '--instructions', 'Apply Henry’s headline'])).out;
r = (await run('teng', ['save', S, '--file', png, '--parent', `${S}_v1`, '--review', p.id, '--note', 'Shorter headline', '--meta', '{}', '--key', 'rev-1']));
ok('revision saved as v2 on top of v1', r.code === 0 && r.out.id === `${S}_v2`, JSON.stringify(r.out).slice(0, 200));
r = (await run('teng', ['complete', p.id, '--rev', String(p.rev), '--version', `${S}_v2`, '--note', 'Applied headline']));
ok('review completed; feedback resolved into v2', r.code === 0 && r.out.status === 'done' && (await run('teng', ['get', S])).out.comments[0].status === 'applied');
ok('nothing left in the inbox', (await run('teng', ['inbox'])).out.items.length === 0);

// no connector: handoff bundle
r = execFileSync('python3', [script, 'handoff', path.join(tmp, 'bundle'), '--title', 'Offline ad', '--format', 'feed45', '--files', png, src, '--meta', '{"concept":"memory"}'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
const h = JSON.parse(r);
ok('without a connection, a handoff bundle is made and marked not saved', h.manifest.saved_to_library === false && h.manifest.asset_id === null && h.manifest.files.length === 2);
r = (() => { try { execFileSync('python3', [script, 'me'], { encoding: 'utf8', env: { PATH: process.env.PATH } }); return 0; } catch (e) { return JSON.parse(e.stdout).error; } })();
ok('without a token the helper says so instead of pretending', r === 'not_configured');

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
