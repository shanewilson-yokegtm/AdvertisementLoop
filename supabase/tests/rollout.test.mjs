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
const asset = { id: 'asset', concept_name: 'Test ad', kind: 'static', format: 'square', latest_version: 1 };
const member = { user_id: 'shane', role: 'admin' };

function reviewFixture(initial = [v1], query = '') {
  const writes = []; const rows = { assets: [asset], versions: initial, reviews: [], comments: [], shares: [] };
  let Page;
  const render = () => root.render(React.createElement(Page));
  const mocks = {
    'next/link': { __esModule: true, default: p => React.createElement('a', p, p.children) },
    'next/navigation': { useParams: () => ({ id: 'asset' }), useSearchParams: () => new URLSearchParams(query), useRouter: () => ({ replace: url => { query = url.split('?')[1] || ''; render(); } }) },
    '@/lib/data': { useRows: table => ({ rows: rows[table], ready: true }), useSigned: () => ({}), useMembers: () => () => 'Shane', can: () => true, fmtDate: () => '', fmtSec: () => '', fmtBytes: () => '', isVideo: () => false, FORMATS: {}, KIND_LABEL: {} },
    '@/lib/supabase/browser': { sb: () => ({ from: table => ({ upsert: async row => { writes.push({ table, ...row }); return { error: null }; } }) }) },
    '@/components/Shell': { useApp: () => ({ member, toast: () => {} }) },
    '@/components/Media': { Player: ({ v }) => React.createElement('div', { id: 'selected-media' }, v.id) },
    '@/components/Chips': { statusChip: () => null, renderChip: () => null },
    '@/components/Upload': { __esModule: true, default: () => null },
    '@/components/Share': { __esModule: true, default: () => null },
    '@/components/VoiceNote': { __esModule: true, default: () => null },
  };
  Page = source('src/app/a/[id]/page.tsx', mocks).default;
  return { Page, rows, writes, render };
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
