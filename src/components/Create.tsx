'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { useRows, useSigned, useMembers, can, fmtDate, FORMATS, KIND_LABEL, saveVersion, type Asset, type Version } from '@/lib/data';
// @ts-ignore -- plain JS canvas renderers
import { renderStatic, renderMotion } from '@/lib/render';
import { Thumb } from './Media';
import { useApp } from './Shell';

type CType = 'static' | 'motion' | 'higgsfield';
const TYPES: [CType, string][] = [['static', 'Static'], ['motion', 'Infographic video'], ['higgsfield', 'Higgsfield video']];
const HIGGSFIELD_CONNECTED = false;
const HF_REQ = "Higgsfield isn't connected. A claude.ai Owner must add the Higgsfield connector (mcp.higgsfield.ai/mcp) on Yoke's existing Higgsfield account, and Shane must approve a budget. Until then your idea is saved as a pending Library item; no video is made.";

function TypeBar({ value, onChange }: { value: CType; onChange: (t: CType) => void }) {
  return <div className="typebar" role="radiogroup" aria-label="What to make">
    {TYPES.map(([k, l], i) => <button key={k} type="button" role="radio" aria-checked={value === k} tabIndex={value === k ? 0 : -1} className="tbtn"
      onClick={() => onChange(k)} onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = TYPES[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3][0]; onChange(n); (e.currentTarget.parentElement?.children[TYPES.findIndex(x => x[0] === n)] as HTMLElement)?.focus(); } }}>
      {l}{k === 'higgsfield' && !HIGGSFIELD_CONNECTED ? <span className="tnote"> · not connected</span> : null}</button>)}
  </div>;
}
const TypeNote = ({ t }: { t: CType }) => (t === 'higgsfield' && !HIGGSFIELD_CONNECTED ? <div className="banner">{HF_REQ}</div> : null);
// Claude replies are on only when the server has an API key (checked via /api/health).
function useClaudeOn() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { fetch('/api/health').then(r => r.json()).then(j => setOn(!!j?.configured?.claude)).catch(() => setOn(false)); }, []);
  return on;
}
const ClaudeOff = ({ on }: { on: boolean | null }) => (on === false ? <div className="banner" role="status"><span><b>Claude: off</b> · replies switch on once an Anthropic API key is added. Messages and type choices are still saved.</span></div> : null);

export function CreateHome() {
  const { member, toast } = useApp(); const router = useRouter(); const who = useMembers();
  const chats = useRows<any>('chats', { order: 'updated_at' });
  const [t, setT] = useState<CType>('static'); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const claudeOn = useClaudeOn();
  return <>
    <div className="head"><h1>Create an ad</h1>{claudeOn === false ? <span className="chip">Claude: off</span> : claudeOn ? <span className="chip live">Claude: on</span> : null}</div>
    <div style={{ marginBottom: 12 }}><ClaudeOff on={claudeOn} /></div>
    {!can(member, 'creator') ? <div className="banner" style={{ marginBottom: 12 }}>View-only access · ask Shane for Creator</div> : null}
    <form className="composer panel" onSubmit={async e => {
      e.preventDefault(); const body = text.trim(); if (!body || !can(member, 'creator')) return; setBusy(true);
      const { data, error } = await sb().from('chats').insert({ title: body.slice(0, 70), create_type: t, created_by: member!.user_id }).select('id').single();
      if (error) { toast('Couldn’t start · ' + error.message); setBusy(false); return; }
      try { sessionStorage.setItem('pending:' + data.id, JSON.stringify({ body, t })); } catch { /* ok */ }
      router.push(`/create/${data.id}`);
    }}>
      <TypeBar value={t} onChange={setT} /><TypeNote t={t} />
      <label className="f">What&apos;s the ad?<textarea rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Owners who keep saying they'll follow up next week" /></label>
      <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Pick a type, describe the idea. Drafts land in the Library.</span><button className="btn primary" disabled={busy || !can(member, 'creator')}>Start</button></div>
    </form>
    {chats.rows.length ? <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 8 }}><h2>Ads in progress</h2>
      <div className="list">{chats.rows.map((c: any) => <Link className="li" key={c.id} href={`/create/${c.id}`}><div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><b>{c.title}</b>
        <span className="muted">{who(c.last_by || c.created_by)} · {fmtDate(c.updated_at)}{c.asset_id ? ' · iterating a Library asset' : ''}</span></div></Link>)}</div></div> : null}
  </>;
}

export function ChatView({ id }: { id: string }) {
  const { member, toast } = useApp(); const who = useMembers();
  const chatQ = useRows<any>('chats', { filter: ['id', id] }); const chat = chatQ.rows[0];
  const msgs = useRows<any>('chat_messages', { filter: ['chat_id', id], order: 'at', asc: true });
  const assets = useRows<Asset>('assets'); const versions = useRows<Version>('versions');
  const [t, setT] = useState<CType | null>(null); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<string | null>(null); const [status, setStatus] = useState('');
  const type: CType = t || chat?.create_type || 'static';
  const vById = Object.fromEntries(versions.rows.map(v => [v.id, v])); const aById = Object.fromEntries(assets.rows.map(a => [a.id, a]));
  const refs = msgs.rows.flatMap((m: any) => m.asset_refs || []);
  const urls = useSigned(refs.map((r: any) => { const v = vById[r.version_id]; return v ? (v.poster_path || (v.content_type?.startsWith('image/') ? v.file_path : null)) : null; }));
  const started = useRef(false); const claudeOn = useClaudeOn();

  const setType = (k: CType) => { setT(k); if (can(member, 'creator')) sb().from('chats').update({ create_type: k }).eq('id', id).then(() => {}); };

  async function send(body: string, ty: CType) {
    if (!body || busy) return; setBusy(true); setStatus('');
    const { error } = await sb().from('chat_messages').insert({ chat_id: id, role: 'user', body, create_type: ty });
    if (error) { setStatus('Not saved · ' + error.message); setText(body); setBusy(false); return; }
    const made: { asset_id: string; version_id: string }[] = [];
    let blocked: string | null = null;
    if (ty === 'higgsfield' && !HIGGSFIELD_CONNECTED) {
      blocked = 'higgsfield_not_connected';
      try { const r = await saveVersion({ assetId: chat?.asset_id && aById[chat.asset_id]?.kind === 'video' ? chat.asset_id : null, newAsset: { concept_name: (chat?.title || body).slice(0, 70), kind: 'video', format: 'vertical', chat_id: id },
          render: { state: 'pending', label: 'Waiting on Higgsfield', note: HF_REQ }, spec: { type: 'higgsfield', idea: body }, source: { tool: 'Higgsfield (not connected)', prompt: 'Idea: ' + body, chatId: id } });
        made.push({ asset_id: r.assetId, version_id: r.versionId }); if (!chat?.asset_id) await sb().from('chats').update({ asset_id: r.assetId }).eq('id', id);
      } catch (e: any) { setStatus('Pending item not saved · ' + e.message); }
    }
    setLive('Thinking…');
    let turn: any[] = [];
    for (let round = 0; round < 4; round++) {
      const r = await fetch('/api/claude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chatId: id, type: ty, turn, assetRefs: made, blocked }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 503) { setStatus('Saved · Claude is off'); break; }
      if (!r.ok) { setStatus('Claude stopped · ' + (j.error || r.status)); break; }
      if (j.stop === 'end_turn') { setStatus(''); break; }
      // tool round: run each tool here, in the browser, then hand the results back
      const results: any[] = [];
      for (const b of j.content.filter((x: any) => x.type === 'tool_use')) {
        try {
          const s = b.input || {};
          const out: any = b.name === "make_static_ad" ? await renderStatic(s) : await renderMotion(s, (p: string) => setStatus(p));
          setStatus('Saving to Library…');
          const kind = b.name === 'make_static_ad' ? 'static' : 'motion';
          const linked = chat?.asset_id ? aById[chat.asset_id] : null;
          const sameAsset = linked && linked.format === out.fmt && (linked.kind === 'static') === (kind === 'static') ? linked.id
            : assets.rows.find(a => a.chat_id === id && a.format === out.fmt && (a.kind === 'static') === (kind === 'static'))?.id;
          const saved = await saveVersion({ assetId: sameAsset || null, newAsset: { concept_name: s.name || chat?.title || 'Ad', kind, format: out.fmt, chat_id: id },
            file: out.blob, poster: out.poster, width: out.W, height: out.H, duration: out.dur, revisionNote: s.changeNote || null,
            source: { tool: kind === 'static' ? 'Ad Studio · Claude static' : 'Ad Studio · Claude motion', model: 'Claude', prompt: 'Made in Create an ad · ' + (chat?.title || ''), chatId: id },
            render: { state: 'ready', kind: kind === 'static' ? 'in_app_canvas' : 'in_app_recording' }, spec: { type: kind, ...s, format: out.fmt, ...(out.beats ? { beats: out.beats } : {}) },
            copy: { conceptName: s.name, primaryText: [s.primaryText].filter(Boolean), headlines: [s.headline].filter(Boolean), cta: 'Learn more', destination: '' } });
          made.push({ asset_id: saved.assetId, version_id: saved.versionId });
          if (!chat?.asset_id) await sb().from('chats').update({ asset_id: saved.assetId }).eq('id', id);
          results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify({ saved: true, assetId: saved.assetId, version: saved.version }) });
        } catch (e: any) { results.push({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: String(e?.message || e).slice(0, 300) }); }
      }
      turn = [...turn, { role: 'assistant', content: j.content }, { role: 'user', content: results }];
      setLive('Thinking…');
    }
    setLive(null); setBusy(false);
  }

  useEffect(() => {
    if (started.current || !chat || !msgs.ready) return; started.current = true;
    try { const p = sessionStorage.getItem('pending:' + id); if (p) { sessionStorage.removeItem('pending:' + id); const { body, t: pt } = JSON.parse(p); if (!msgs.rows.length) send(body, pt); } } catch { /* ok */ }
  }, [chat, msgs.ready]); // eslint-disable-line

  if (!chatQ.ready) return <div className="empty"><span className="muted">Loading</span></div>;
  if (!chat) return <div className="empty"><h2>Not found</h2><Link className="btn" href="/create">All ads</Link></div>;
  return <div className="chatwrap">
    <div className="head" style={{ margin: 0 }}><div style={{ minWidth: 0 }}><Link href="/create" className="muted">← All ads</Link><h1>{chat.title}</h1></div>
      {chat.asset_id ? <Link className="btn" href={`/a/${chat.asset_id}`}>Open in Library</Link> : null}</div>
    <div className="thread" role="log" aria-live="polite">
      {!msgs.rows.length ? <div className="muted">Tell Claude the idea. Pick Static, Infographic video or Higgsfield video.</div> : msgs.rows.map((m: any) => <div key={m.id} className={'msg ' + (m.role === 'user' ? 'me' : 'ai')}>
        <div className="who">{m.role === 'user' ? who(m.author) : 'Claude'}{m.create_type ? ' · ' + TYPES.find(x => x[0] === m.create_type)?.[1] : ''}{m.role !== 'user' && m.author ? ' · asked by ' + who(m.author) : ''} · {fmtDate(m.at)}</div>
        <div className="txt">{m.body}</div>
        {(m.asset_refs || []).map((r: any) => { const a = aById[r.asset_id], v = vById[r.version_id]; if (!a || !v) return <div key={r.version_id} className="att muted">Saving to Library…</div>;
          return <div className="att" key={r.version_id}><div className={`thumb mini ${a.format}`}><Thumb v={v} urls={urls} /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}><b>{a.concept_name} · v{v.version}</b><span className="muted">{KIND_LABEL[a.kind]} · {FORMATS[a.format]?.label} · in Library</span>
              <div className="row"><Link className="btn small" href={`/a/${a.id}`}>Open</Link></div></div></div>; })}
        {m.error ? <span className="chip err">{m.error}</span> : null}</div>)}
      {live ? <div className="msg ai"><div className="who">Claude</div><div className="txt">{live}</div></div> : null}
    </div>
    <form className="composer" onSubmit={e => { e.preventDefault(); const b = text.trim(); if (!b) return; setText(''); send(b, type); }}>
      <ClaudeOff on={claudeOn} /><TypeBar value={type} onChange={setType} /><TypeNote t={type} />
      <label htmlFor="cmp" className="sr">Message</label>
      <textarea id="cmp" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Describe the ad, or what to change"
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
      <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted" role="status">{status}</span><button className="btn primary" disabled={busy || !can(member, 'creator')}>Send</button></div>
    </form>
  </div>;
}
