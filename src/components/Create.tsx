'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { useRows, useSigned, useMembers, can, fmtDate, FORMATS, KIND_LABEL, saveVersion, canManage, type Asset, type Version } from '@/lib/data';
// @ts-ignore -- plain JS canvas renderers
import { renderStatic, renderMotion } from '@/lib/render';
import { Thumb } from './Media';
import { useApp } from './Shell';
import { HiggsfieldForm, useHiggsfieldOn } from './Higgsfield';
import { assetVersionPath, CHAT_LIMIT_MESSAGE, CHAT_MESSAGE_LIMIT } from '@/lib/creative-loop';

type CType = 'static' | 'motion' | 'higgsfield';
type Attempt = { messageId: string; body: string; type: CType; saved: boolean; made: { asset_id: string; version_id: string }[]; blocked: string | null; turn: any[] };
const TYPES: [CType, string][] = [['static', 'Static'], ['motion', 'Infographic video'], ['higgsfield', 'Higgsfield video']];
const HF_REQ = "Higgsfield isn't switched on for this app yet (HF_CREDENTIALS missing on the server). Your idea is saved as a pending Library item; no video is made.";

function TypeBar({ value, onChange, hf }: { value: CType; onChange: (t: CType) => void; hf: boolean | null }) {
  return <div className="typebar" role="radiogroup" aria-label="What to make">
    {TYPES.map(([k, l], i) => <button key={k} type="button" role="radio" aria-checked={value === k} tabIndex={value === k ? 0 : -1} className="tbtn"
      onClick={() => onChange(k)} onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = TYPES[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3][0]; onChange(n); (e.currentTarget.parentElement?.children[TYPES.findIndex(x => x[0] === n)] as HTMLElement)?.focus(); } }}>
      {l}{k === 'higgsfield' && hf === false ? <span className="tnote"> · not connected</span> : null}</button>)}
  </div>;
}
const TypeNote = ({ t, hf }: { t: CType; hf: boolean | null }) => (t === 'higgsfield' && hf === false ? <div className="banner">{HF_REQ}</div> : null);
// Claude replies are on only when the server has an API key (checked via /api/health).
function useClaudeOn() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { fetch('/api/health').then(r => r.json()).then(j => setOn(!!j?.configured?.claude)).catch(() => setOn(false)); }, []);
  return on;
}
// Only the chat composer (Static, Infographic video) needs Claude replies; Higgsfield renders without it.
const ClaudeOff = ({ on }: { on: boolean | null }) => (on === false ? <p className="hint" role="status">Claude replies here are switched off for now. Your idea is still saved, and the Claude skill can make it.</p> : null);

export function CreateHome() {
  const { member, toast } = useApp(); const router = useRouter(); const who = useMembers();
  const chats = useRows<any>('chats', { order: 'updated_at' });
  const [t, setT] = useState<CType>('static'); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const claudeOn = useClaudeOn(); const hf = useHiggsfieldOn();
  const hfForm = t === 'higgsfield' && hf;
  return <>
    <div className="head"><h1>Create an ad</h1></div>
    {!can(member, 'creator') ? <div className="banner" style={{ marginBottom: 12 }}>View-only access · ask Shane for Creator</div> : null}
    {hfForm ? <div className="composer panel"><TypeBar value={t} onChange={setT} hf={hf} />
      <HiggsfieldForm initialPrompt={text} disabled={!can(member, 'creator')} toast={toast} /></div> :
    <form className="composer panel" onSubmit={async e => {
      e.preventDefault(); const body = text.trim(); if (!body || busy || !can(member, 'creator')) return; setBusy(true);
      try {
      const { data, error } = await sb().from('chats').insert({ title: body.slice(0, 70), create_type: t, created_by: member!.user_id }).select('id').single();
      if (error) { toast('Couldn’t start · ' + error.message); setBusy(false); return; }
      try { sessionStorage.setItem('pending:' + data.id, JSON.stringify({ body, t })); } catch { /* ok */ }
      router.push(`/create/${data.id}`);
      } catch { toast('Couldn’t start. Your idea is still here; please retry.'); }
      finally { setBusy(false); }
    }}>
      <TypeBar value={t} onChange={setT} hf={hf} /><TypeNote t={t} hf={hf} /><ClaudeOff on={claudeOn} />
      <label className="f">What&apos;s the ad?<textarea rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Owners who keep saying they'll follow up next week" /></label>
      <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Pick a type, describe the idea. Drafts land in the Library.</span><button className="btn primary" disabled={busy || !can(member, 'creator')}>Start</button></div>
    </form>}
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
  const [retry, setRetry] = useState<Attempt | null>(null); const [limitReached, setLimitReached] = useState(false);
  const sending = useRef(false);
  const atLimit = limitReached || msgs.rows.length >= CHAT_MESSAGE_LIMIT;
  const type: CType = t || chat?.create_type || 'static';
  const vById = Object.fromEntries(versions.rows.map(v => [v.id, v])); const aById = Object.fromEntries(assets.rows.map(a => [a.id, a]));
  const refs = msgs.rows.flatMap((m: any) => m.asset_refs || []);
  const urls = useSigned(refs.map((r: any) => { const v = vById[r.version_id]; return v ? (v.poster_path || (v.content_type?.startsWith('image/') ? v.file_path : null)) : null; }));
  const started = useRef(false); const claudeOn = useClaudeOn(); const hf = useHiggsfieldOn();

  const setType = (k: CType) => { setT(k); if (can(member, 'creator')) sb().from('chats').update({ create_type: k }).eq('id', id).then(() => {}); };

  async function send(body: string, ty: CType, previous?: Attempt) {
    if (!body || sending.current || !can(member, 'creator')) return;
    if (atLimit && !previous) { setLimitReached(true); return; }
    sending.current = true; setBusy(true); setStatus(''); setRetry(null);
    const attempt: Attempt = previous || { messageId: crypto.randomUUID(), body, type: ty, saved: false, made: [], blocked: null, turn: [] };
    const made = attempt.made;
    try {
    if (!attempt.saved) {
      const { error } = await sb().from('chat_messages').insert({ id: attempt.messageId, chat_id: id, role: 'user', body, create_type: ty });
      // A lost insert response is safe to retry with the same UUID.
      if (error && error.code !== '23505') throw error;
      attempt.saved = true;
    }
    if (ty === 'higgsfield' && !hf) {
      attempt.blocked = 'higgsfield_not_connected';
      if (!made.length) {
      try { const r = await saveVersion({ assetId: chat?.asset_id && aById[chat.asset_id]?.kind === 'video' ? chat.asset_id : null, newAsset: { concept_name: (chat?.title || body).slice(0, 70), kind: 'video', format: 'vertical', chat_id: id },
          render: { state: 'pending', label: 'Waiting on Higgsfield', note: HF_REQ }, spec: { type: 'higgsfield', idea: body }, source: { tool: 'Higgsfield (not connected)', prompt: 'Idea: ' + body, chatId: id } });
        made.push({ asset_id: r.assetId, version_id: r.versionId }); if (!chat?.asset_id) await sb().from('chats').update({ asset_id: r.assetId }).eq('id', id);
      } catch (e: any) { throw new Error('Pending item not saved · ' + e.message); }
      }
    }
    setLive('Thinking…');
    for (let round = 0; round < 4; round++) {
      const r = await fetch('/api/claude', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(120_000), body: JSON.stringify({ chatId: id, type: ty, turn: attempt.turn, assetRefs: made, blocked: attempt.blocked, replyTo: attempt.messageId }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 503) { setStatus('Saved · Claude is off'); return; }
      if (r.status === 409 && j.error === 'chat_limit_reached') { setLimitReached(true); return; }
      if (!r.ok) throw new Error(j.error || String(r.status));
      if (j.stop === 'end_turn') { setStatus(''); return; }
      if (j.stop !== 'tool_use' || !Array.isArray(j.content)) throw new Error('Claude returned an incomplete response');
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
      attempt.turn.push({ role: 'assistant', content: j.content }, { role: 'user', content: results });
      setLive('Thinking…');
    }
    throw new Error('Claude needs another step to finish. Retry to continue.');
    } catch (e: any) {
      setRetry(attempt);
      setStatus((attempt.saved ? 'Your message is saved. ' : 'Your message could not be confirmed. ') + 'Connection interrupted or request failed · ' + (e.message || 'Please retry'));
    } finally {
      setLive(null); setBusy(false); sending.current = false;
    }
  }

  async function startNextChat() {
    if (sending.current || !can(member, 'creator')) return;
    sending.current = true; setBusy(true);
    try {
      const { data, error } = await sb().from('chats').insert({ title: chat.title, create_type: type, asset_id: chat.asset_id || null, created_by: member!.user_id }).select('id').single();
      if (error) throw error;
      location.href = `/create/${data.id}`;
    } catch (e: any) { toast('Couldn’t start a new chat · ' + e.message); }
    finally { sending.current = false; setBusy(false); }
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
    <div className="msgs" role="log" aria-live="polite">
      {!msgs.rows.length ? <div className="muted">Tell Claude the idea. Pick Static, Infographic video or Higgsfield video.</div> : msgs.rows.map((m: any) => <div key={m.id} className={'msg ' + (m.role === 'user' ? 'me' : 'ai')}>
        <div className="who">{m.role === 'user' ? who(m.author) : 'Claude'}{m.create_type ? ' · ' + TYPES.find(x => x[0] === m.create_type)?.[1] : ''}{m.role !== 'user' && m.author ? ' · asked by ' + who(m.author) : ''} · {fmtDate(m.at)}</div>
        <div className="txt">{m.body}</div>
        {(m.asset_refs || []).map((r: any) => { const a = aById[r.asset_id], v = vById[r.version_id]; if (!a || !v) return <div key={r.version_id} className="att muted">Saving to Library…</div>;
          return <div className="att" key={r.version_id}><div className={`thumb mini ${a.format}`}><Thumb v={v} urls={urls} /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}><b>{a.concept_name} · v{v.version}</b><span className="muted">{KIND_LABEL[a.kind]} · {FORMATS[a.format]?.label} · in Library</span>
              <div className="row"><Link className="btn small" href={assetVersionPath(a.id, v.id)}>Open</Link></div></div></div>; })}
        {m.error ? <span className="chip err">{m.error}</span> : null}</div>)}
      {live ? <div className="msg ai"><div className="who">Claude</div><div className="txt">{live}</div></div> : null}
    </div>
    {atLimit ? <div className="banner" role="status"><span>{CHAT_LIMIT_MESSAGE}</span><button className="btn primary" disabled={busy || !can(member, 'creator')} onClick={startNextChat}>Start a new chat</button></div> : null}
    {retry ? <div className="banner" role="status"><span>{status}</span><button className="btn" disabled={busy} onClick={() => send(retry.body, retry.type, retry)}>Retry saved request</button><button className="btn" disabled={busy} onClick={() => { setRetry(null); setStatus('You can continue with another message.'); }}>Continue chatting</button></div> : null}
    {type === 'higgsfield' && hf ? (() => { const linked = chat.asset_id ? aById[chat.asset_id] : null; const own = linked && linked.kind === 'video' && canManage(member, linked) ? linked : null;
      const lastIdea = [...msgs.rows].reverse().find((m: any) => m.role === 'user')?.body || '';
      return <div className="composer"><TypeBar value={type} onChange={setType} hf={hf} />
        {own ? <span className="muted">New version of {own.concept_name}</span> : null}
        <HiggsfieldForm assetId={own?.id || null} conceptName={chat.title} initialPrompt={lastIdea} chatId={id} disabled={!can(member, 'creator')} toast={toast} /></div>; })() :
    <form className="composer" onSubmit={e => { e.preventDefault(); const b = text.trim(); if (!b || busy || atLimit || retry) return; setText(''); send(b, type); }}>
      <ClaudeOff on={claudeOn} /><TypeBar value={type} onChange={setType} hf={hf} /><TypeNote t={type} hf={hf} />
      <label htmlFor="cmp" className="sr">Message</label>
      <textarea id="cmp" rows={2} disabled={atLimit} value={text} onChange={e => setText(e.target.value)} placeholder="Describe the ad, or what to change"
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
      <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted" role="status">{retry ? '' : status}</span><button className="btn primary" disabled={busy || atLimit || !!retry || !can(member, 'creator')}>Send</button></div>
    </form>}
  </div>;
}
