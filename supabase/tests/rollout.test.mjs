import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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
    if (id.startsWith('@/')) { const f = 'src/' + id.slice(2); return source(existsSync(path.join(rootDir, f + '.ts')) ? f + '.ts' : f + '.tsx', mocks); }
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
const buttonStarting = text => [...document.querySelectorAll('button')].find(b => b.textContent.startsWith(text));
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
    '@/components/Process': { __esModule: true, default: () => React.createElement('div', { id: 'process-panel' }), activeProcessing: p => (p && ['approved', 'executing'].includes(p.status) ? p : null) },
    '@/components/ChangeLog': { __esModule: true, default: () => null },
    '@/components/Higgsfield': { useHiggsfieldPoll: () => {} },
    '@/lib/supabase/browser': { sb: () => ({ from: table => ({ insert: async row => { writes.push({ table, ...row }); return { error: null }; }, upsert: async row => { writes.push({ table, ...row }); return { error: null }; }, update: row => ({ eq: async (k, val) => { writes.push({ table, ...row, [k]: val }); return { error: null }; } }) }) }) },
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
  await act(async () => button('Approve v1').click());
  assert.equal(f.writes[0].version_id, v1.id);
  await act(async () => button('v2').click());
  assert.equal(document.getElementById('selected-media').textContent, v2.id);
  await finish();
});

test('a shared link opens its exact version and an unknown version never falls back to latest', async () => {
  let f = reviewFixture([v1, v2], 'v=asset_v1'); await mount(f.Page);
  assert.equal(document.getElementById('selected-media').textContent, v1.id); await finish();
  f = reviewFixture([v1, v2], 'v=missing'); await mount(f.Page);
  assert.match(document.body.textContent, /Version not found/); assert.equal(button('Approve v1'), undefined); await finish();
});

test('pending media cannot be approved in the UI', async () => {
  const f = reviewFixture([{ ...v1, file_path: null, render: { state: 'pending' } }]); await mount(f.Page);
  assert.equal(button('Approve v1').disabled, true); await act(async () => button('Approve v1').click());
  assert.equal(f.writes.length, 0); await finish();
});

test('one feedback box: needs text, then saves feedback on the version being viewed', async () => {
  const f = reviewFixture(); await mount(f.Page);
  assert.equal(button('Request changes'), undefined, 'no separate request-changes flow');
  assert.equal(button('Add feedback').disabled, true);
  const box = document.getElementById('cmt');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => { setter.call(box, 'Make the logo bigger'); box.dispatchEvent(new window.Event('input', { bubbles: true })); });
  assert.equal(button('Add feedback').disabled, false);
  await act(async () => { box.form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }); await act(async () => {});
  assert.deepEqual(f.writes.map(w => [w.table, w.version_id, w.body]), [['comments', v1.id, 'Make the logo bigger']]);
  await finish();
});

test('the action row is Approve, Share, Download, with the rest under More', async () => {
  const f = reviewFixture(); await mount(f.Page);
  const row = button('Share').parentElement;
  assert.deepEqual([...row.children].filter(e => e.tagName === 'BUTTON').map(b => b.textContent), ['Approve v1', 'Share', 'Download']);
  assert.ok(row.querySelector('summary[aria-label="More actions"]'), 'secondary actions sit behind More');
  assert.ok(row.querySelector('details .menu').contains(buttonStarting('Reject ad')), 'Reject ad lives in the More menu');
  for (const label of ['Iterate with Claude', 'Upload new version', 'Suggest a change', 'Share for review']) assert.equal(button(label), undefined, label + ' gone');
  await finish();
});

test('reject removes the ad from the Library', async () => {
  const f = reviewFixture(); await mount(f.Page);
  await act(async () => buttonStarting('Reject ad').click());
  assert.deepEqual(f.writes.map(w => [w.table, w.id, w.archived]), [['assets', 'asset', true]]);
  assert.deepEqual(f.pushed, ['/']);
  await finish();
});

test('a member who does not own the ad can comment but cannot revise, reject or process it', async () => {
  member = { user_id: 'teng', role: 'creator' };
  const f = reviewFixture([v1, v2], 'v=asset_v1'); await mount(f.Page);
  for (const label of ['Share', 'Download']) assert.ok(button(label), label + ' shown');
  assert.ok(!buttonStarting('Reject ad'), 'Reject ad hidden'); assert.ok(!button('Revert to v1'), 'Revert hidden');
  assert.equal(document.querySelectorAll('.decide').length, 0, 'no approve/reject controls on someone else’s ad');
  assert.equal(document.getElementById('process-panel'), null);
  assert.ok(document.getElementById('cmt'), 'comment box available');
  await finish(); member = { user_id: 'shane', role: 'admin' };
});

test('the owner sees Regenerate once there is feedback, and can revert an older version', async () => {
  member = { user_id: 'shane', role: 'creator' };
  let f = reviewFixture([v1, v2], 'v=asset_v1'); await mount(f.Page);
  assert.equal(document.getElementById('process-panel'), null, 'no Regenerate bar with nothing to act on'); await finish();
  f = reviewFixture([v1, v2], 'v=asset_v1'); f.rows.comments = [{ id: 'c1', asset_id: 'asset', version_id: v1.id, author: 'teng', body: 'Bigger logo', status: 'open', created_at: '' }]; await mount(f.Page);
  assert.ok(document.getElementById('process-panel'));
  assert.ok(button('Revert to v1'));
  await finish(); member = { user_id: 'shane', role: 'admin' };
});

// ---------- Feedback: one thread (approve/reject per item) + one Regenerate ad action (real components) ----------
const cA = { id: 'c-a', asset_id: 'asset', version_id: 'asset_v2', author: 'teng', body: 'Shorter headline', status: 'open', created_at: '' };
const cB = { id: 'c-b', asset_id: 'asset', version_id: 'asset_v1', author: 'henry', body: 'Coral CTA', status: 'open', created_at: '', decision: 'approved' };
const cC = { id: 'c-c', asset_id: 'asset', version_id: 'asset_v1', author: 'henry', body: 'Louder', status: 'dismissed', created_at: '', resolution_note: 'Sound is fine' };
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
function threadFixture(comments, manage = true, inFlight = []) {
  const calls = [];
  const Thread = source('src/components/FeedbackThread.tsx', {
    '@/lib/supabase/browser': { sb: () => ({ rpc: async (fn, args) => { calls.push({ fn, args }); return { data: {}, error: null }; } }) },
    '@/lib/data': { fmtDate: () => '', fmtSec: s => String(s) },
  }).default;
  const props = { comments, vs: [v1, v2], manage, inFlight: new Set(inFlight), nextVersion: 3, who: id => id || 'Claude', audioUrls: {}, toast: () => {}, reload: () => {} };
  return { Thread: () => React.createElement(Thread, props), calls };
}
function regenFixture(proc, comments) {
  const calls = [];
  const Bar = source('src/components/Process.tsx', {
    '@/lib/supabase/browser': { sb: () => ({ rpc: async (fn, args) => { calls.push({ fn, args }); return { data: {}, error: null }; } }) },
    '@/lib/data': { fmtDate: () => '' },
  }).default;
  const props = { a: asset, vs: [v1, v2], comments, proc, reload: () => {}, toast: () => {}, onOpen: () => {} };
  return { Bar: () => React.createElement(Bar, props), calls };
}
const decideBtns = label => [...document.querySelectorAll('.decide button')].filter(b => b.textContent === label);

test('owner: Approve and Reject on each item save right away; Approve again undoes', async () => {
  const f = threadFixture([cA, cB]); await mount(f.Thread);
  assert.equal(f.calls.length, 0, 'opening the ad changes nothing');
  assert.equal(decideBtns('Approve')[0].getAttribute('aria-pressed'), 'false');
  assert.equal(decideBtns('Approve')[1].getAttribute('aria-pressed'), 'true');
  await act(async () => decideBtns('Approve')[0].click()); await flush();
  await act(async () => decideBtns('Reject')[0].click()); await flush();
  await act(async () => decideBtns('Approve')[1].click()); await flush();
  assert.deepEqual(f.calls.map(c => [c.args.p_comment, c.args.p_decision]), [['c-a', 'approved'], ['c-a', 'rejected'], ['c-b', 'undecided']]);
  await finish();
});

test('one thread: decided items are kept as history, rejected ones can be undone by the owner', async () => {
  const f = threadFixture([cA, cB, cC], true, ['c-b']); await mount(f.Thread);
  assert.equal(decideBtns('Approve').length, 1, 'only undecided, not-in-flight items get controls');
  const t = document.body.textContent;
  assert.match(t, /Going into v3/); assert.match(t, /Rejected/); assert.match(t, /Reason: Sound is fine/);
  await act(async () => button('Undo').click()); await flush();
  assert.deepEqual(f.calls.map(c => [c.args.p_comment, c.args.p_decision]), [['c-c', 'undecided']]);
  await finish();
});

test('teammates read the full attributed thread without decision controls', async () => {
  const f = threadFixture([cA, cB, cC], false); await mount(f.Thread);
  assert.equal(document.querySelectorAll('.decide').length, 0); assert.ok(!button('Undo'));
  const t = document.body.textContent;
  assert.match(t, /teng/); assert.match(t, /Shorter headline/); assert.match(t, /Waiting for owner/); assert.match(t, /Approved for next version/);
  await finish();
});

test('Regenerate ad sends everything approved (server collects it), not a snapshot', async () => {
  let f = regenFixture(null, [cA]); await mount(f.Bar);
  assert.equal(button('Regenerate ad').disabled, true, 'nothing approved yet'); await finish();
  f = regenFixture(null, [cA, cB]); await mount(f.Bar);
  assert.match(document.body.textContent, /1 approved change → v3/);
  await act(async () => button('Regenerate ad').click()); await flush();
  assert.deepEqual(f.calls.map(c => [c.fn, c.args.p_asset]), [['feedback_process', 'asset']]);
  await finish();
});

test('after Regenerate, the owner sees it queued (no instant promise) and can cancel before Claude starts', async () => {
  const proc = { id: 'p1', asset_id: 'asset', reviewed_version_id: 'asset_v2', comment_ids: ['c-b'], status: 'approved', decisions: [{ comment_id: 'c-b', decision: 'apply' }], rev: 4, history: [] };
  const f = regenFixture(proc, [cA, cB]); await mount(f.Bar);
  assert.match(document.body.textContent, /Queued for v3/); assert.match(document.body.textContent, /Claude starts within the hour/);
  assert.ok(!button('Regenerate ad'), 'no second request while one is queued');
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

test('Library: one card per asset; same titles are never merged; counts, links and downloads stay per asset', async () => {
  const mk = (id, name, format, owner, status, archived = false) => ({ a: { id, concept_name: name, kind: 'motion', format, archived, owner_id: owner }, v: { id: id + '_v2', asset_id: id, version: 2, file_path: id + '/v2.mp4', poster_path: null, content_type: 'video/mp4', created_at: '2026-10-29T10:00:00Z' }, status });
  // Same title, different owners, and same owner twice: all independent ads.
  const list = [mk('a1', 'Clay: Credit math', 'feed45', 'shane', 'approved'), mk('a2', 'Clay: Credit math', 'vertical', 'shane', 'approved'),
    mk('b1', 'Clay: Credit math', 'vertical', 'teng', 'changes'), mk('b2', 'Other', 'feed45', 'teng', null), mk('c1', 'Old one', 'square', 'shane', null, true)];
  const rows = { assets: list.map(x => x.a), versions: list.map(x => x.v), reviews: list.filter(x => x.status).map(x => ({ version_id: x.v.id, status: x.status })), comments: [] };
  const signedFor = [];
  const Page = source('src/app/page.tsx', {
    'next/link': { __esModule: true, default: p => React.createElement('a', p, p.children) },
    '@/lib/data': { useRows: t => ({ rows: rows[t], ready: true, reload: () => {} }), useSigned: () => ({}), useMembers: () => id => ({ shane: 'Shane', teng: 'Teng' })[id] || 'Teammate',
      useInbox: (scope, on = true) => ({ rows: scope === 'all' && on ? [{ asset_id: 'b1', pending: 2 }] : [] }), can: () => true,
      FORMATS: { feed45: { label: '4:5' }, vertical: { label: '9:16' }, square: { label: '1:1' } }, KIND_LABEL: {} },
    '@/lib/supabase/browser': { sb: () => ({ storage: { from: () => ({ createSignedUrl: async (p, _s, o) => { signedFor.push([p, o.download]); return { data: { signedUrl: 'about:blank#' + p } }; } }) } }) },
    '@/components/Media': { Thumb: () => null }, '@/components/Shell': { useApp: () => ({ member }) },
    '@/components/Upload': { __esModule: true, default: () => null }, '@/components/Chips': { statusChip: s => React.createElement('span', null, s), renderChip: () => null },
  }).default;
  await mount(Page);
  const cards = () => [...document.querySelectorAll('.grid:not(details .grid) .card')];
  const hrefs = () => cards().map(c => c.querySelector('a').getAttribute('href')).sort();
  assert.deepEqual(hrefs(), ['/a/a1', '/a/a2', '/a/b1', '/a/b2'], 'four separate ads; the archived one is not in the main grid');
  assert.match(cards().find(c => c.querySelector('a').getAttribute('href') === '/a/b1').querySelector('.sub').textContent, /Teng · 9:16/, 'owner and format on each card');
  const pick = label => [...document.querySelectorAll('[role=radio]')].find(b => b.textContent.startsWith(label));
  const views = [...document.querySelectorAll('[role=radiogroup][aria-label="Show"] [role=radio]')].map(b => b.textContent);
  assert.deepEqual(views, ['All4', 'Feedback for you0', 'Approved2'], 'three views, not a wall of status pills');
  await act(async () => pick('Approved').click());
  assert.deepEqual(hrefs(), ['/a/a1', '/a/a2']);
  await act(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Download Clay: Credit math, 9:16').click(); await new Promise(r => setTimeout(r, 0)); });
  assert.deepEqual(signedFor.map(x => x[0]), ['a2/v2.mp4'], 'downloads exactly that asset');
  assert.match(signedFor[0][1], /Clay Credit math 9x16\.mp4/);
  // Feedback is personal by default; an admin widens it deliberately. Counts belong to the one asset.
  await act(async () => pick('Feedback for you').click());
  assert.deepEqual(hrefs(), [], 'nothing waiting on Shane personally');
  await act(async () => pick('Everyone’s').click());
  assert.deepEqual(hrefs(), ['/a/b1'], 'only the asset with feedback, not its same-title neighbours');
  assert.equal(document.querySelector('.count').textContent, '2');
  await act(async () => pick('All').click());
  assert.ok(!pick('Everyone’s'), 'scope control only in the feedback view');
  const search = document.querySelector('input[type=search]'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(search, 'teng'); search.dispatchEvent(new window.Event('input', { bubbles: true })); });
  assert.deepEqual(hrefs(), ['/a/b1', '/a/b2'], 'search matches owners too');
  await finish();
});

test('Library: members see no admin scope control', async () => {
  member = { user_id: 'teng', role: 'creator' };
  const Page = source('src/app/page.tsx', {
    'next/link': { __esModule: true, default: p => React.createElement('a', p, p.children) },
    '@/lib/data': { useRows: () => ({ rows: [], ready: true }), useSigned: () => ({}), useMembers: () => () => '', useInbox: () => ({ rows: [] }), can: () => true, FORMATS: {} },
    '@/lib/supabase/browser': { sb: () => ({}) }, '@/components/Media': { Thumb: () => null }, '@/components/Shell': { useApp: () => ({ member }) },
    '@/components/Upload': { __esModule: true, default: () => null }, '@/components/Chips': { statusChip: () => null, renderChip: () => null },
  }).default;
  await mount(Page);
  await act(async () => [...document.querySelectorAll('[role=radio]')].find(b => b.textContent.startsWith('Feedback for you')).click());
  assert.equal([...document.querySelectorAll('[role=radio]')].find(b => b.textContent.startsWith('Everyone')), undefined);
  assert.match(document.body.textContent, /No ads yet/);
  assert.equal([...document.querySelectorAll('a')].filter(a => a.textContent === 'Create an ad').length, 1, 'one Create call to action');
  await finish(); member = { user_id: 'shane', role: 'admin' };
});

test('account menu holds role, Connect Claude and Sign out; Escape closes it', async () => {
  const { AccountMenu } = source('src/components/Shell.tsx', {
    'next/link': { __esModule: true, default: p => React.createElement('a', p, p.children) }, 'next/navigation': { usePathname: () => '/' },
    '@/lib/data': { useMember: () => ({}), useInbox: () => ({ rows: [] }) }, '@/lib/supabase/browser': { sb: () => ({}) }, './Feedback': { __esModule: true, default: () => null },
  });
  await mount(() => React.createElement(AccountMenu, { member: { user_id: 'teng', email: 'teng@yokegtm.com', display_name: 'Teng He', role: 'creator' }, email: null }));
  const toggle = document.querySelector('.acct > button');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false'); assert.equal(document.querySelector('.menu'), null);
  await act(async () => toggle.click());
  const t = document.querySelector('.menu').textContent;
  assert.match(t, /Teng He/); assert.match(t, /Creator/); assert.match(t, /Connect Claude/); assert.match(t, /Sign out/);
  assert.equal(document.querySelector('.menu a[href="/connect"]').getAttribute('role'), 'menuitem');
  await act(async () => { document.querySelector('.acct').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(document.querySelector('.menu'), null);
  await finish();
});
