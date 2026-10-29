'use client';
import { useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { useRows, fmtDate } from '@/lib/data';
import { useApp } from '@/components/Shell';

type Token = { id: string; label: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

// Personal tokens for your own Claude. A token acts as you, with your permissions, and nothing more.
export default function Connect() {
  const { toast } = useApp();
  const tokens = useRows<Token>('api_tokens', { order: 'created_at' });
  const [label, setLabel] = useState('My Claude'); const [fresh, setFresh] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const api = typeof window !== 'undefined' ? `${location.origin}/api/v1` : '/api/v1';
  return <>
    <div className="head"><h1>Connect your Claude</h1></div>
    <div className="panel" style={{ maxWidth: 720 }}>
      <p>Your Claude uses a personal token to save ads to the Library and process feedback on ads you own, as you. It can read and comment on teammates’ ads, but can’t change them.</p>
      <form className="row" onSubmit={async e => {
        e.preventDefault(); setBusy(true);
        const { data, error } = await sb().rpc('api_token_create', { p_label: label });
        setBusy(false);
        if (error) { toast('Not created · ' + error.message); return; }
        setFresh((data as any[])[0].token); tokens.reload();
      }}>
        <label className="sr" htmlFor="tl">Label</label><input id="tl" value={label} onChange={e => setLabel(e.target.value)} maxLength={80} />
        <button className="btn primary" disabled={busy}>Create token</button>
      </form>
      {fresh ? <div className="banner" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <b>Copy it now. It won’t be shown again.</b>
        <code className="mono" style={{ wordBreak: 'break-all' }}>{fresh}</code>
        <div className="row"><button className="btn small" onClick={async () => { try { await navigator.clipboard.writeText(fresh); toast('Copied'); } catch { toast('Select and copy it manually'); } }}>Copy</button>
          <button className="btn small" onClick={() => setFresh(null)}>Done</button></div>
        <span className="muted">Keep it out of chats and shared docs. Put it in your Claude environment as <code>AD_STUDIO_TOKEN</code>, with <code>AD_STUDIO_API={api}</code>.</span>
      </div> : null}
      <h3>Your tokens</h3>
      {!tokens.rows.length ? <p className="muted">None yet.</p> : tokens.rows.map(t => <div key={t.id} className="row" style={{ justifyContent: 'space-between' }}>
        <span><b>{t.label}</b> <span className="mono muted">{t.prefix}…</span> <span className="muted">· made {fmtDate(t.created_at)} · {t.last_used_at ? 'used ' + fmtDate(t.last_used_at) : 'not used yet'}</span></span>
        {t.revoked_at ? <span className="chip">Revoked</span> : <button className="btn small quiet-danger" onClick={async () => { const { error } = await sb().rpc('api_token_revoke', { p_id: t.id }); toast(error ? error.message : 'Revoked'); tokens.reload(); }}>Revoke</button>}
      </div>)}
    </div>
  </>;
}
