'use client';
import { useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { FORMATS, KIND_LABEL, type Asset, type Version } from '@/lib/data';
import { useApp } from './Shell';
import { assetVersionPath } from '@/lib/creative-loop';

export function shareText(a: Asset, v: Version, note: string) {
  const url = `${location.origin}${assetVersionPath(a.id, v.id)}`;
  return `*${a.concept_name}* · v${v.version} · ${KIND_LABEL[a.kind]} ${FORMATS[a.format]?.label || a.format} -- for review` + (note ? `\n> ${note.replace(/\n/g, '\n> ')}` : '') + `\n${url}`;
}

export default function Share({ a, v, onClose }: { a: Asset; v: Version; onClose: () => void }) {
  const { member, toast } = useApp();
  const [channel, setChannel] = useState(() => { try { return localStorage.getItem('shareChannel') || ''; } catch { return ''; } });
  const [note, setNote] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const record = (ch: string | null, link: string | null) => sb().from('shares').insert({ asset_id: a.id, version_id: v.id, channel: ch, note: note.trim() || null, link, shared_by: member!.user_id });
  return <div className="modal" role="dialog" aria-modal="true" aria-labelledby="shT">
    <form className="box" onSubmit={async e => {
      e.preventDefault(); const ch = channel.trim().replace(/^#?/, '#'); if (ch === '#') { setMsg('Type a channel'); return; }
      setBusy(true); setMsg('Sending');
      const r = await fetch('/api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: a.id, versionId: v.id, channel: ch, note: note.trim() || null, origin: location.origin }) });
      const j = await r.json().catch(() => ({}));
      setBusy(false);
      if (r.status === 503) { setMsg('Slack isn’t connected to the hosted studio yet · use Copy message'); return; }
      if (!r.ok) { setMsg(j.error || 'Slack send failed'); return; }
      try { localStorage.setItem('shareChannel', ch); } catch { /* ignore */ }
      toast('Shared to ' + ch); onClose();
    }}>
      <div className="head" style={{ margin: 0 }}><h2 id="shT">Share for review</h2><button type="button" className="btn" onClick={onClose}>Close</button></div>
      <div><b>{a.concept_name}</b> <span className="muted">v{v.version}</span></div>
      <label className="f">Slack channel<input type="text" value={channel} onChange={e => setChannel(e.target.value)} placeholder="#creative-review" /></label>
      <label className="f">Note or question (optional)<textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Is the hook too much?" /></label>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(shareText(a, v, note.trim())); await record(null, `${location.origin}${assetVersionPath(a.id, v.id)}`); toast('Copied · paste it anywhere'); } catch { setMsg('Copy blocked · select the text manually'); } }}>Copy message</button>
        <div className="row"><span className="muted" role="status">{msg}</span><button className="btn primary" disabled={busy}>Send to Slack</button></div>
      </div>
    </form></div>;
}
