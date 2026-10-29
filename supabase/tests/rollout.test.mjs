import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://studio.example/create/chat' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
const React = require('react'); const { act } = React; const { createRoot } = require('react-dom/client');
const rootDir = path.resolve(import.meta.dirname, '../..');

// Execute the real components/routes. Only external services and unrelated media are substituted.
function source(file, mocks = {}) {
  const code = ts.transpileModule(readFileSync(path.join(rootDir, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const localRequire = id => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('@/')) return source('src/' + id.slice(2) + '.ts', mocks);
    return require(id);
  };
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  return module.exports;
}
const rules = source('src/lib/creative-loop.ts');
let root;
async function mount(Component) {
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Component)));
}
async function finish() { await act(async () => root?.unmount()); sessionStorage.clear(); }
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text);
const v1 = { id: 'asset_v1', asset_id: 'asset', version: 1, file_path: 'one.png', poster_path: null, render: { state: 'ready' }, content_type: 'image/png', qa: [], copy: {}, source: {} };
const v2 = { ...v1, id: 'asset_v2', version: 2, file_path: 'two.png' };
const asset = { id: 'asset', concept_name: 'Test ad', kind: 'static', format: 'square', latest_version: 1, owner_id: 'shane' };
let member = { user_id: 'shane', role: 'admin' };

function reviewFixture(initial = [v1], query = '') {
  const writes = []; const pushed = []; const rows = { assets: [asset], versions: initial, reviews: [], comments: [], shares: [], revision_jobs: [], processing: [], higgsfield_jobs: [] };
  let Page;
  const render = () => root.render(React.createElement(Page));
  const mocks = {
    'next/link': { __esModule: true, default: p => React.createElement('a', p, p.children) },
    'next/navigation': { useParams: () => ({ id: 'asset' }), useSearchParams: () => new URLSearchParams(query), useRouter: () => ({ replace: url => { query = url.split('?')[1] || ''; render(); }, push: url => { pushed.push(url); } }) },
    '@/lib/data': { useRows: table => ({ rows: rows[table], ready: true, reload: () => {} }), useSigned: () => ({}), useMembers: () => () => 'Shane', can: () => true, canManage: (m, a) => m.role === 'admin' || a?.owner_id === m.user_id, fmtDate: () => '', fmtSec: () => '', fmtBytes: () => '', isVideo: () => false, FORMATS: {}, KIND_LABEL: {} },
    '@/components/Process': { __esModule: true, default: () => React.createElement('div', { id: 'process-panel' }) },
    '@/components/ChangeLog': { __esModule: true, default: () => null },
    '@/components/Higgsfield': { useHiggsfieldPoll: () => {} },
    '@/lib/supabase/browser': { sb: () => ({ from: table => ({ upsert: async row => { writes.push({ table, ...row }); return { error: null }; }, update: row => ({ eq: async (k, val) => { writes.push({ table, ...row, [k]: val }); return { error: null }; } }) }) }) },
    '@/components/Shell': { useApp: () => ({ member, toast: () => {} }) },
    '@/components/Media': { Player: ({ v }) => React.createElement('div', { id: 'selected-media' }, v.id) },
    '@/components/Chips': { statusChip: () => null, renderChip: () => null },
    '@/components/Upload': { __esModule: true, default: () => null },
    '@/components/Share': { __esModule: true, default: () => null },
    '@/components/VoiceNote': { useRecorder: () => ({ state: 'idle', sec: 0, take: null, supported: false, start: async () => {}, stop: () => {}, clear: () => {} }), saveVoiceComment: async () => 'c1', RecordControl: () => null },
  };
  Page = source('src/app/a/[id]/page.tsx', mocks).default;
  return { Page, rows, writes, render, pushed };
}

test('realtime upload does not move the media or approval target; explicit selection does', async () => {
  const f = reviewFixture(); await mount(f.Page);
  f.rows.versions = [v1, v2]; await act(f.render);
  assert.equal(document.getElementById('selected-media').textContent, v1.id);
  assert.match(document.body.textContent, /newer version is available/);
  await act(async () => button('Approve').click());
  assert.equal(f.writes[0].version_id, v1.id);
  await act(async () => button('v2').click());
  assert.equal(document.getElementById('selected-media').textContent, v2.id);
  await finish();
});

test('a shared link opens its exact version and an unknown version never falls back to latest', async () => {
  let f = reviewFixture([v1, v2], 'v=asset_v1'); await mount(f.Page);
  assert.equal(document.getElementById('selected-media').textContent, v1.id); await finish();
  f = reviewFixture([v1, v2], 'v=missing'); await mount(f.Page);
  assert.match(document.body.textContent, /Version not found/); assert.equal(button('Approve'), undefined); await finish();
});

test('pending media cannot be approved in the UI', async () => {
  const f = reviewFixture([{ ...v1, file_path: null, render: { state: 'pending' } }]); await mount(f.Page);
  assert.equal(button('Approve').disabled, true); await act(async () => button('Approve').click());
  assert.equal(f.writes.length, 0); await finish();
});

test('request changes needs feedback, then records it on the version being reviewed', async () => {
  const f = reviewFixture(); await mount(f.Page);
  assert.equal(button('Request changes').disabled, true);
  const box = document.getElementById('rev-note');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => { setter.call(box, 'Make the logo bigger'); box.dispatchEvent(new window.Event('input', { bubbles: true })); });
  assert.equal(button('Request changes').disabled, false);
  await act(async () => button('Request changes').click());
  assert.deepEqual(f.writes.map(w => [w.table, w.version_id, w.status, w.note]), [['reviews', v1.id, 'changes', 'Make the logo bigger']]);
  await finish();
});

test('reject removes the ad from the Library', async () => {
  const f = reviewFixture(); await mount(f.Page);
  await act(async () => button('Reject ad').click());
  assert.deepEqual(f.writes.map(w => [w.table, w.id, w.archived]), [['assets', 'asset', true]]);
  assert.deepEqual(f.pushed, ['/']);
  await finish();
});

test('a member who does not own the ad can comment but cannot revise, reject or process it', async () => {
  member = { user_id: 'teng', role: 'creator' };
  const f = reviewFixture([v1, v2], 'v=asset_v1'); await mount(f.Page);
  assert.ok(button('Suggest a change'), 'offers a suggestion route');
  for (const label of ['Upload new version', 'Iterate with Claude', 'Reject ad', 'Revert to v1']) assert.equal(button(label), undefined, label + ' hidden');
  assert.equal(document.getElementById('process-panel'), null);
  assert.ok(document.getElementById('cmt'), 'comment box available');
  await finish(); member = { user_id: 'shane', role: 'admin' };
});

test('the owner sees Process feedback and can revert an older version', async () => {
  member = { user_id: 'shane', role: 'creator' };
  const f = reviewFixture([v1, v2], 'v=asset_v1'); await mount(f.Page);
  assert.ok(document.getElementById('process-panel'));
  assert.ok(button('Revert to v1'));
  await finish(); member = { user_id: 'shane', role: 'admin' };
});

// ---------- Owner feedback: Accept / Ignore, then Make next version (real component) ----------
function processFixture(proc, comments) {
  const calls = [];
  const started = { id: 'p-new', asset_id: 'asset', reviewed_version_id: 'asset_v2', comment_ids: comments.filter(c => c.status === 'open').map(c => c.id), status: 'reviewing', proposal: {}, decisions: [], rev: 0, history: [] };
  const Panel = source('src/components/Process.tsx', {
    '@/lib/supabase/browser': { sb: () => ({ rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === 'processing_start') return { data: started, error: null };
      if (fn === 'processing_save_proposal') return { data: { ...(proc || started), proposal: args.p_proposal, rev: args.p_rev + 1 }, error: null };
      return { data: { ...(proc || started), status: 'approved' }, error: null };
    } }) },
    '@/lib/data': { fmtDate: () => '', fmtSec: s => String(s) },
  }).default;
  const props = { a: asset, vs: [v1, v2], comments, proc, reload: () => {}, who: id => id || 'Claude', audioUrls: {}, toast: () => {}, onOpen: () => {}, ownerName: 'Shane' };
  return { Panel: () => React.createElement(Panel, props), calls };
}
const cA = { id: 'c-a', asset_id: 'asset', version_id: 'asset_v2', author: 'teng', body: 'Shorter headline', status: 'open', created_at: '' };
const cB = { id: 'c-b', asset_id: 'asset', version_id: 'asset_v2', author: 'henry', body: 'Coral CTA', status: 'open', created_at: '' };
const cLate = { id: 'c-late', asset_id: 'asset', version_id: 'asset_v2', author: 'henry', body: 'Late idea', status: 'open', created_at: '' };
const reviewing = { id: 'p1', asset_id: 'asset', reviewed_version_id: 'asset_v2', comment_ids: ['c-a', 'c-b'], processor: 'shane', started_via: 'claude', status: 'reviewing',
  proposal: { draft: { decisions: [{ comment_id: 'c-a', decision: 'apply' }], instructions: 'From Claude' } },
  decisions: [], instructions: null, result_version_id: null, message: null, rev: 3, history: [], created_at: '' };
const radio = (i, label) => [...document.querySelectorAll('[role=radio]')].filter(b => b.textContent === label)[i];
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

test('Make next version is off until something is accepted; clicking Accept starts and saves the choice', async () => {
  const f = processFixture(null, [cA, cB]); await mount(f.Panel);
  assert.equal(button('Make next version').disabled, true);
  assert.equal(f.calls.length, 0, 'opening the ad changes nothing');
  await act(async () => radio(0, 'Accept').click()); await flush();
  assert.deepEqual(f.calls.map(c => c.fn), ['processing_start', 'processing_save_proposal']);
  assert.deepEqual(f.calls[1].args.p_proposal.draft.decisions, [{ comment_id: 'c-a', decision: 'apply' }]);
  assert.equal(button('Make next version').disabled, false);
  assert.match(document.body.textContent, /1 accepted · 0 ignored · 1 not decided/);
  await finish();
});

test('ignoring everything offers Close ignored instead of making a version', async () => {
  const f = processFixture(null, [cA]); await mount(f.Panel);
  await act(async () => radio(0, 'Ignore').click()); await flush();
  assert.ok(button('Close ignored') && !button('Close ignored').disabled);
  await finish();
});

test('choices made in Claude show up in the app', async () => {
  const f = processFixture(reviewing, [cA, cB, cLate]); await mount(f.Panel);
  assert.equal(radio(0, 'Accept').getAttribute('aria-checked'), 'true');
  assert.equal(document.getElementById('proc-instr').value, 'From Claude');
  assert.match(document.body.textContent, /1 newer comment came in after you started choosing/);
  await finish();
});

test('Make next version sends only accepted and ignored comments from this round', async () => {
  const f = processFixture(reviewing, [cA, cB, cLate]); await mount(f.Panel);
  await act(async () => radio(1, 'Ignore').click()); await flush();
  await act(async () => button('Make next version').click()); await flush();
  const call = f.calls.find(c => c.fn === 'processing_approve');
  assert.equal(call.args.p_queue_worker, true);
  assert.deepEqual(call.args.p_decisions.map(d => [d.comment_id, d.decision]).sort(), [['c-a', 'apply'], ['c-b', 'dismiss']]);
  assert.ok(!JSON.stringify(call.args).includes('c-late'), 'late comment not included');
  await finish();
});

test('after sending, the owner sees it queued and can cancel before Claude starts', async () => {
  const f = processFixture({ ...reviewing, status: 'approved', decisions: [{ comment_id: 'c-a', decision: 'apply' }] }, [cA, cB]); await mount(f.Panel);
  assert.match(document.body.textContent, /v3 arrives within the hour/);
  await act(async () => button('Cancel').click()); await flush();
  assert.equal(f.calls[0].fn, 'processing_set_status'); assert.equal(f.calls[0].args.p_status, 'cancelled');
  await finish();
});

test('the change log shows what changed, accepted and ignored feedback', async () => {
  const log = [{ kind: 'version', at: '', version_id: 'asset_v2', version: 2, from_version: 1, made_by: 'Claude', what_changed: 'Shorter headline',
    round: { reviewed_version: 1, decided_by: 'Shane', note: 'Keep the visual', accepted: [{ author: 'Teng', body: 'Shorter headline', at_sec: 3, source: 'slack', source_link: 'https://slack/p1' }], ignored: [{ author: 'Henry', body: 'Coral CTA', at_sec: null, source: 'app', source_link: null, reason: 'Off brief' }] } }];
  const CL = source('src/components/ChangeLog.tsx', { '@/lib/supabase/browser': { sb: () => ({ rpc: async () => ({ data: log, error: null }) }) }, '@/lib/data': { fmtDate: () => 'Oct 29', fmtSec: s => '0:0' + s } }).default;
  await mount(() => React.createElement(CL, { assetId: 'asset', refreshKey: '1', onOpen: () => {} })); await flush();
  const t = document.body.textContent;
  assert.match(t, /Shorter headline/); assert.match(t, /Accepted · 1/); assert.match(t, /Teng at 0:03/); assert.match(t, /Ignored · 1/); assert.match(t, /Off brief/); assert.match(t, /Note from Shane: Keep the visual/);
  await finish();
});

test('copyable review message includes the version in its URL', () => {
  const share = source('src/components/Share.tsx', { '@/lib/data': { FORMATS: {}, KIND_LABEL: {} }, '@/lib/supabase/browser': {}, './Shell': {} });
  assert.match(share.shareText(asset, v1, ''), /\/a\/asset\?v=asset_v1/);
  assert.notEqual(rules.assetVersionPath('asset', v1.id), rules.assetVersionPath('asset', v2.id));
});

function chatFixture(messages = []) {
  const inserts = []; const rows = { chats: [{ id: 'chat', title: 'Test', create_type: 'static' }], chat_messages: messages, assets: [], versions: [] };
  const mocks = {
    'next/link': { __esModule: true, default: p => React.createElement('a', p, p.children) },
    'next/navigation': { useRouter: () => ({}) },
    '@/lib/data': { useRows: table => ({ rows: rows[table], ready: true }), useSigned: () => ({}), useMembers: () => () => 'Shane', can: () => true, fmtDate: () => '', FORMATS: {}, KIND_LABEL: {} },
    '@/lib/supabase/browser': { sb: () => ({ from: table => ({ insert: async row => { inserts.push({ table, ...row }); return { error: null }; } }) }) },
    '@/lib/render': {}, './Media': {}, './Shell': { useApp: () => ({ member, toast: () => {} }) },
    './Higgsfield': { useHiggsfieldOn: () => false, HiggsfieldForm: () => null },
  };
  const Chat = source('src/components/Create.tsx', mocks).ChatView;
  return { Page: () => React.createElement(Chat, { id: 'chat' }), inserts };
}

test('lost connection releases chat controls and retry does not insert the user message twice', async () => {
  const originalFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async url => {
    if (url === '/api/health') return { json: async () => ({ configured: { claude: true } }) };
    if (++requests === 1) throw Error('Offline');
    return { ok: true, status: 200, json: async () => ({ stop: 'end_turn' }) };
  };
  try {
    sessionStorage.setItem('pending:chat', JSON.stringify({ body: 'Make the ad', t: 'static' }));
    const f = chatFixture(); await mount(f.Page);
    assert.equal(button('Retry saved request').disabled, false); assert.doesNotMatch(document.body.textContent, /Thinking…/);
    await act(async () => button('Retry saved request').click());
    assert.equal(f.inserts.length, 1); assert.equal(requests, 2); assert.equal(button('Send').disabled, false);
    await finish();
  } finally { globalThis.fetch = originalFetch; }
});

test('the conversation limit offers a new chat and stops accepting more messages', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => ({ configured: { claude: false } }) });
  try {
    const f = chatFixture(Array.from({ length: rules.CHAT_MESSAGE_LIMIT }, (_, i) => ({ id: String(i), role: 'user', body: 'Message' })));
    await mount(f.Page); assert.equal(button('Send').disabled, true);
    assert.equal(button('Start a new chat').disabled, false); assert.match(document.body.textContent, /Library versions are saved/);
    await finish();
  } finally { globalThis.fetch = originalFetch; }
});

test('the API refuses oversized history before calling Anthropic', async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'unit-test-only';
  let called = false; const previousFetch = globalThis.fetch; globalThis.fetch = async () => { called = true; throw Error('Unexpected API call'); };
  const client = { from: table => {
    const query = { select: () => query, eq: () => query, order: () => query, maybeSingle: async () => ({ data: table === 'chats' ? { id: 'chat' } : {} }), limit: () => query, throwOnError: async () => ({ data: Array(61).fill({ role: 'user', body: 'Message' }) }), then: fn => Promise.resolve({ data: [] }).then(fn) };
    return query;
  } };
  try {
    const route = source('src/app/api/claude/route.ts', { 'next/server': { NextResponse: { json: (data, init = {}) => ({ data, status: init.status || 200 }) } }, '@/lib/supabase/server': { currentMember: async () => ({ ...member, client }) }, '@/lib/server/prompt': {} });
    const response = await route.POST({ json: async () => ({ chatId: 'chat', type: 'static' }) });
    assert.equal(response.status, 409); assert.equal(response.data.error, 'chat_limit_reached'); assert.equal(called, false);
  } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey; }
});

test('media links renew on return to an old tab and do not re-sign healthy links', async () => {
  const realNow = Date.now; let now = 0, calls = 0;
  Date.now = () => now;
  const data = source('src/lib/data.ts', { './supabase/browser': { sb: () => ({ storage: { from: () => ({ createSignedUrls: async paths => ({ data: paths.map(p => ({ path: p, signedUrl: 'url-' + ++calls })) }) }) } }) } });
  const Page = () => React.createElement('div', { id: 'url' }, data.useSigned(['movie.mp4'])['movie.mp4']);
  try {
    await mount(Page); assert.equal(document.getElementById('url').textContent, 'url-1');
    await act(async () => window.dispatchEvent(new window.Event('focus'))); assert.equal(calls, 1);
    now = 56 * 60_000;
    await act(async () => window.dispatchEvent(new window.Event('focus')));
    assert.equal(document.getElementById('url').textContent, 'url-2'); await finish();
  } finally { Date.now = realNow; }
});

test('renewing the same video URL preserves its playhead and playback intent', async () => {
  const proto = dom.window.HTMLMediaElement.prototype;
  const load = proto.load, play = proto.play; let plays = 0;
  proto.load = function () { this.currentTime = 0; };
  proto.play = async () => { plays++; };
  let url = 'https://media.example/first';
  const { Player } = source('src/components/Media.tsx', { '@/lib/data': { isVideo: () => true, fmtSec: () => '' } });
  try {
    const Page = () => React.createElement(Player, { v: v1, urls: { 'one.png': url } });
    await mount(Page); const video = document.getElementById('pv');
    video.dispatchEvent(new window.Event('loadedmetadata'));
    video.currentTime = 7; Object.defineProperty(video, 'paused', { configurable: true, value: false });
    Object.defineProperty(video, 'duration', { configurable: true, value: 60 });
    url = 'https://media.example/renewed'; await act(async () => root.render(React.createElement(Page)));
    video.dispatchEvent(new window.Event('loadedmetadata'));
    assert.equal(video.currentTime, 7); assert.equal(plays, 1); await finish();
  } finally { proto.load = load; proto.play = play; }
});

test('Higgsfield form: 9 s default, 4-12 s, 720p, sound toggle, one request per press', async () => {
  const pushed = []; const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url === '/api/higgsfield/usage') return new Response(JSON.stringify({ seconds_this_month: 14, generations_this_month: 1, monthly_cap_seconds: null }));
    return new Response(JSON.stringify({ asset_id: 'ast_x', version_id: 'ast_x_v1', job_id: 'j', status: 'submitted' }));
  };
  if (!globalThis.crypto?.randomUUID) globalThis.crypto = require('node:crypto').webcrypto;
  const { HiggsfieldForm } = source('src/components/Higgsfield.tsx', { 'next/navigation': { useRouter: () => ({ push: u => pushed.push(u) }) } });
  await mount(() => React.createElement(HiggsfieldForm, { toast: () => {} }));
  await act(async () => {});
  const range = document.querySelector('input[type=range]');
  assert.equal(range.value, '9'); assert.equal(range.min, '4'); assert.equal(range.max, '12');
  assert.match(document.body.textContent, /720p/); assert.match(document.body.textContent, /14s made this month/);
  assert.ok(document.querySelector('input[role=switch]'));
  assert.equal(button('Generate 9s video').disabled, true, 'needs a prompt');
  const ta = document.querySelector('textarea');
  const setVal = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v); el.dispatchEvent(new window.Event('input', { bubbles: true })); };
  await act(async () => setVal(ta, 'A rep closes the laptop'));
  await act(async () => { document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  const gen = calls.filter(c => c.url === '/api/higgsfield/generate');
  assert.equal(gen.length, 1);
  assert.equal(gen[0].body.duration, 9); assert.equal(gen[0].body.format, 'vertical'); assert.equal(gen[0].body.audio, true); assert.ok(gen[0].body.idempotency_key);
  assert.deepEqual(pushed, ['/a/ast_x?v=ast_x_v1']);
  globalThis.fetch = realFetch; await finish();
});
