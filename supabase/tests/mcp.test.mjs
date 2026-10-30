// Claude connector (remote MCP + Supabase OAuth 2.1) against every migration in PGlite, with locally generated keys.
// Covers: connector tokens refused by the Data API/RLS/Storage, the audience hook, revocation, token verification
// (issuer, audience, algorithm, client, expiry), and the MCP tools acting with the member's own permissions.
// No network. Usage: node supabase/tests/mcp.test.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { pgClient } from './pgshim.mjs';

const here = import.meta.dirname; const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const cache = {};
function load(file) {
  if (cache[file]) return cache[file];
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} }; cache[file] = m.exports;
  new Function('require', 'module', 'exports', code)(id => id === './api' ? load('src/lib/server/api.ts') : id === './slack' ? load('src/lib/server/slack.ts') : id === './higgsfield' ? load('src/lib/server/higgsfield.ts') : require(id), m, m.exports);
  return Object.assign(cache[file], m.exports);
}
const auth = load('src/lib/server/mcp-auth.ts');
const { buildMcpServer, TOOL_NAMES } = load('src/lib/server/mcp-tools.ts');
const { authenticate } = load('src/lib/server/api.ts');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`); };
const rejects = async p => { try { await p; return null; } catch (e) { return e; } };

const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create table auth.sessions (id uuid primary key, user_id uuid, not_after timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;`);
for (const f of readdirSync(path.join(here, '../migrations')).filter(f => f.endsWith('.sql')).sort())
  await db.exec(readFileSync(path.join(here, '../migrations', f), 'utf8').split('-- @supabase-only')[0].replace(/^alter publication.*$/gm, ''));
const SHANE = '00000000-0000-0000-0000-00000000000a', TENG = '00000000-0000-0000-0000-00000000000c', HENRY = '00000000-0000-0000-0000-0000000000cc';
await db.exec(`insert into role_grants values ('shane.wilson@yokegtm.com','admin');
  insert into auth.users(id,email) values ('${SHANE}','shane.wilson@yokegtm.com'),('${TENG}','teng.he@yokegtm.com'),('${HENRY}','henry@yokegtm.com');`);
const claims = c => `select set_config('request.jwt.claims', '${JSON.stringify(c)}', false)`;
const asUser = async (c, sql) => { await db.exec(`${claims(c)}; set role authenticated;`); try { return await db.query(sql); } finally { await db.exec(`reset role; ${claims({})}`); } };

// ---------- database: connector tokens never reach tables, RPCs or Storage ----------
const tables = (await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`)).rows.map(r => r.relname);
const guarded = new Set((await db.query(`select tablename from pg_policies where schemaname='public' and policyname='no_oauth_connector' and permissive='RESTRICTIVE'`)).rows.map(r => r.tablename));
const missing = tables.filter(t => !guarded.has(t));
ok('every public table has the restrictive connector guard (new tables must add it)', !missing.length, missing.join(', '));
await db.exec(`set role service_role; ${claims({})};`);
const sdb = pgClient(db);
await db.exec('reset role');
// Seed an ad owned by Teng with one comment, through the normal API path.
const tokenFor = async uid => { const r = await db.exec(`${claims({ sub: uid, role: 'authenticated' })}; select token from api_token_create('t');`); await db.exec(claims({})); return r[1].rows[0].token; };
const teng = await authenticate(sdb, `Bearer ${await tokenFor(TENG)}`);
const henry = await authenticate(sdb, `Bearer ${await tokenFor(HENRY)}`);
const shane = await authenticate(sdb, `Bearer ${await tokenFor(SHANE)}`);
const { handle } = load('src/lib/server/api.ts');
const APP = 'https://studio.example';
const asset = await handle(sdb, teng, 'POST', ['assets'], { concept_name: 'Sticky notes', kind: 'static', format: 'feed45' }, new URLSearchParams(), APP);
const v1 = await handle(sdb, teng, 'POST', ['assets', asset.id, 'versions'], { render_state: 'pending', render_note: 'brief', idempotency_key: 'seed-0001' }, new URLSearchParams(), APP);
const cmt = await handle(sdb, henry, 'POST', ['assets', asset.id, 'comments'], { version_id: v1.id, body: 'Bigger logo' }, new URLSearchParams(), APP);

const browser = { sub: TENG, role: 'authenticated' }, connector = { sub: TENG, role: 'authenticated', client_id: 'claude-connector' };
ok('a browser session still reads its ads', (await asUser(browser, `select id from assets where id = '${asset.id}'`)).rows.length === 1);
ok('a connector token reads no rows directly', (await asUser(connector, `select id from assets`)).rows.length === 0 && (await asUser(connector, `select id from comments`)).rows.length === 0);
ok('a connector token cannot write directly', !!(await rejects(asUser(connector, `insert into comments(asset_id, version_id, body) values ('${asset.id}', '${v1.id}', 'x')`))));
ok('a connector token cannot even read its own member row', (await asUser(connector, `select * from members`)).rows.length === 0);
ok('pre-request check refuses connector tokens (tables and RPCs)', /connector tokens only work/.test((await rejects(asUser(connector, `select app_private.deny_oauth_data_api()`)))?.message || ''));
ok('pre-request check lets browser sessions through', (await asUser(browser, `select app_private.deny_oauth_data_api()`)).rows.length === 1);

// ---------- audience hook ----------
await db.exec(`update app_private.mcp_oauth_config set resource = 'https://studio.example/api/mcp', client_ids = '{claude-connector}'`);
const hook = async ev => (await db.query(`select public.mcp_access_token_hook($1::jsonb) as e`, [JSON.stringify(ev)])).rows[0].e;
const base = { user_id: TENG, claims: { aud: 'authenticated', sub: TENG, role: 'authenticated' } };
ok('hook: browser sessions unchanged', (await hook(base)).claims.aud === 'authenticated');
ok('hook: registered connector gets the MCP resource as audience', (await hook({ ...base, claims: { ...base.claims, client_id: 'claude-connector' } })).claims.aud === 'https://studio.example/api/mcp');
ok('hook: any other OAuth client gets an audience nothing accepts', (await hook({ ...base, client_id: 'someone-else', claims: { ...base.claims, client_id: 'someone-else' } })).claims.aud === 'unregistered-oauth-client');
ok('hook and config are not callable from the API', !!(await rejects(asUser(browser, `select public.mcp_access_token_hook('{}'::jsonb)`))) && !!(await rejects(asUser(browser, `select * from app_private.mcp_oauth_config`))));

// ---------- revocation ----------
const SID = '11111111-1111-1111-1111-111111111111';
await db.exec(`insert into auth.sessions values ('${SID}', '${TENG}', null)`);
const live = async id => (await db.query(`select public.mcp_session_active($1) as a`, [id])).rows[0].a;
ok('live session accepted, deleted session refused', (await live(SID)) === true && (await live('22222222-2222-2222-2222-222222222222')) === false);
ok('session check is service-only', !!(await rejects(asUser(browser, `select public.mcp_session_active('${SID}')`))));

// ---------- token verification ----------
const ISS = 'https://ref.supabase.co/auth/v1';
const cfg = auth.mcpConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://ref.supabase.co', APP_URL: 'https://studio.example', MCP_OAUTH_CLIENT_IDS: 'claude-connector', MCP_CONNECTOR_ENABLED: 'true' });
ok('config: resource and metadata derived from APP_URL', cfg.resource === 'https://studio.example/api/mcp' && cfg.issuer === ISS && cfg.metadataUrl === 'https://studio.example/.well-known/oauth-protected-resource/api/mcp');
ok('config: off unless explicitly enabled with a client id', auth.mcpConfig({ NEXT_PUBLIC_SUPABASE_URL: 'x', APP_URL: 'y', MCP_OAUTH_CLIENT_IDS: 'c' }) === null && auth.mcpConfig({ NEXT_PUBLIC_SUPABASE_URL: 'x', APP_URL: 'y', MCP_CONNECTOR_ENABLED: 'true' }) === null);
const { privateKey, publicKey } = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
const keys = createLocalJWKSet({ keys: [jwk] });
const now = Math.floor(Date.now() / 1000);
const mint = (over = {}, { key = privateKey, alg = 'ES256' } = {}) => new SignJWT({ role: 'authenticated', client_id: 'claude-connector', session_id: SID, ...over })
  .setProtectedHeader({ alg, kid: 'k1' }).setIssuer(over.iss ?? ISS).setAudience(over.aud ?? cfg.resource).setSubject(over.sub ?? TENG).setIssuedAt(now - 10).setExpirationTime(over.exp ?? now + 3600).sign(key);
const verify = async t => { try { return await auth.verifyMcpToken(`Bearer ${t}`, cfg, keys); } catch (e) { return e; } };
const good = await verify(await mint());
ok('valid connector token accepted', good.sub === TENG && good.clientId === 'claude-connector' && good.sessionId === SID);
ok('default Supabase audience ("authenticated") refused', (await verify(await mint({ aud: 'authenticated' }))).code === 'invalid_token');
ok('another resource\'s audience refused', (await verify(await mint({ aud: 'https://other.example/api/mcp' }))).code === 'invalid_token');
ok('other issuer refused', (await verify(await mint({ iss: 'https://evil.supabase.co/auth/v1' }))).code === 'invalid_token');
ok('other OAuth client refused', (await verify(await mint({ client_id: 'someone-else' }))).code === 'invalid_token');
ok('browser token without client_id refused', (await verify(await new SignJWT({ role: 'authenticated', session_id: SID }).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setIssuer(ISS).setAudience(cfg.resource).setSubject(TENG).setIssuedAt(now).setExpirationTime(now + 600).sign(privateKey))).code === 'invalid_token');
ok('expired token refused', /expired/i.test((await verify(await mint({ exp: now - 120 }))).message));
ok('anon role refused', (await verify(await mint({ role: 'anon' }))).code === 'invalid_token');
const hs = await new SignJWT({ role: 'authenticated', client_id: 'claude-connector' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(ISS).setAudience(cfg.resource).setSubject(TENG).setIssuedAt(now).setExpirationTime(now + 600).sign(new TextEncoder().encode('shared-secret-xxxxxxxxxxxxxxxxxxxxxxx'));
ok('HS256 (shared-secret) tokens refused', (await verify(hs)).code === 'invalid_token');
const other = await generateKeyPair('ES256');
ok('token signed by an unknown key refused', (await verify(await mint({}, { key: other.privateKey }))).code === 'invalid_token');
ok('missing or malformed header: 401 invalid_request with discovery challenge', (await rejects(auth.verifyMcpToken('Basic abc', cfg, keys)))?.code === 'invalid_request'
  && auth.challenge(cfg) === 'Bearer resource_metadata="https://studio.example/.well-known/oauth-protected-resource/api/mcp"');
ok('bad token challenge carries error and description', /error="invalid_token", error_description=/.test(auth.challenge(cfg, new auth.McpAuthError(401, 'invalid_token', 'Token "x" expired'))));
const prm = auth.resourceMetadata(cfg, 'https://studio.example');
ok('protected resource metadata points at Supabase Auth', prm.resource === cfg.resource && prm.authorization_servers[0] === ISS && prm.bearer_methods_supported[0] === 'header');
ok('removed session refused at the endpoint check', (await rejects(auth.requireLiveSession(sdb, { ...good, sessionId: '22222222-2222-2222-2222-222222222222' })))?.code === 'invalid_token');
ok('live session passes', (await rejects(auth.requireLiveSession(sdb, good))) === null);
ok('member resolved with current role', (await auth.mcpActor(sdb, TENG)).role === 'creator');
ok('non-member refused', (await rejects(auth.mcpActor(sdb, '99999999-9999-9999-9999-999999999999')))?.status === 403);

// ---------- MCP tools: same permissions as the app ----------
async function connect(actor) {
  const server = buildMcpServer(sdb, actor, APP);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1' }); await client.connect(b);
  return client;
}
const parse = r => { try { return JSON.parse(r.content[0].text); } catch { return r.content?.[0]?.text; } };
const cT = await connect(teng), cH = await connect(henry), cS = await connect(shane);
const tools = (await cT.listTools()).tools;
ok('every tool is listed with a title and annotations', TOOL_NAMES.every(n => tools.find(t => t.name === n && t.annotations && t.title)) && tools.length === TOOL_NAMES.length);
const paid = tools.find(t => t.name === 'higgsfield_generate'), slack = tools.find(t => t.name === 'post_to_slack');
ok('paid generation and Slack posting are separate open-world tools', paid.annotations.openWorldHint === true && slack.annotations.openWorldHint === true && tools.filter(t => t.annotations.openWorldHint).length === 2);
ok('read tools are marked read-only', ['whoami', 'list_ads', 'get_ad', 'feedback_inbox', 'brand_pack'].every(n => tools.find(t => t.name === n).annotations.readOnlyHint === true));
ok('whoami is the signed-in member', parse(await cT.callTool({ name: 'whoami', arguments: {} })).user_id === TENG);
const got = parse(await cH.callTool({ name: 'get_ad', arguments: { asset_id: asset.id } }));
ok('a teammate reads the full thread but cannot manage', got.you_can_manage === false && got.comments.some(c => c.body === 'Bigger logo'));
const deny = await cH.callTool({ name: 'decide_feedback', arguments: { asset_id: asset.id, feedback_id: cmt.id, decision: 'approved' } });
ok('a teammate cannot decide feedback on someone else\'s ad', deny.isError === true && parse(deny).error === 'forbidden');
const upl = await cH.callTool({ name: 'request_upload_urls', arguments: { asset_id: asset.id, files: [{ name: 'x', content_type: 'image/png' }] } });
ok('a teammate cannot get upload URLs for someone else\'s ad', upl.isError === true && parse(upl).error === 'forbidden');
ok('owner approves the feedback item', !(await cT.callTool({ name: 'decide_feedback', arguments: { asset_id: asset.id, feedback_id: cmt.id, decision: 'approved' } })).isError);
ok('admin can manage anyone\'s ad', parse(await cS.callTool({ name: 'get_ad', arguments: { asset_id: asset.id } })).you_can_manage === true);
const up2 = parse(await cT.callTool({ name: 'request_upload_urls', arguments: { asset_id: asset.id, files: [{ name: 'final', content_type: 'image/png' }] } }));
ok('owner gets presigned PUT URLs scoped to the ad folder', up2.uploads?.[0]?.path.startsWith(asset.id + '/') && up2.uploads[0].method === 'PUT');
const unsaved = await cT.callTool({ name: 'save_version', arguments: { asset_id: asset.id, file_path: up2.uploads[0].path, content_type: 'image/png', idempotency_key: 'mcp-save-0001' } });
ok('saving a file that was never uploaded is refused', unsaved.isError === true && parse(unsaved).error === 'missing_file');
const noConfirm = await cT.callTool({ name: 'higgsfield_generate', arguments: { prompt: 'x', seconds: 4, format: 'vertical', sound: false } });
ok('paid generation refused without explicit person_confirmed', noConfirm.isError === true);
const falseConfirm = await cT.callTool({ name: 'post_to_slack', arguments: { asset_id: asset.id, version_id: v1.id, channel_id: 'C0123456', request_id: 'req-00000001', person_confirmed: false } });
ok('Slack posting refused unless person_confirmed is literally true', falseConfirm.isError === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
