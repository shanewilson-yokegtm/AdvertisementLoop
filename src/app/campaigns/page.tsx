'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/Shell';
import type { CampaignState } from '@/lib/campaigns/contracts';

export default function Campaigns() {
  const { member } = useApp();
  const [rows, setRows] = useState<CampaignState[]>([]);
  const [title, setTitle] = useState(''); const [error, setError] = useState('');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [more, setMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/campaigns', { signal: controller.signal, cache: 'no-store' }).then(async r => {
      const data = await r.json(); if (!r.ok) throw new Error(data.message || 'Could not load campaigns');
      setRows(data.items.map((x: { state: CampaignState }) => x.state)); setMore(data.hasMore);
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      // Keep this key in the form's lifetime so a lost response never creates a second campaign.
      const key = sessionStorage.getItem('campaign-create-key') || crypto.randomUUID(); sessionStorage.setItem('campaign-create-key', key);
      const r = await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, requestKey: key }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.message || 'Could not create campaign');
      sessionStorage.removeItem('campaign-create-key'); location.assign(`/campaigns/${data.state.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create campaign'); setBusy(false); }
  }
  return <section>
    <div className="head"><div><h1>Campaigns</h1><p className="muted">Agree the memo. Build consistently. Learn from what ran.</p></div><Link className="btn" href="/connect">Connect Claude</Link></div>
    <p className="notice">Meta and LinkedIn are awaiting firm account connections. Prepare your campaign memo here and continue the planning conversation in Claude.</p>
    {error ? <p role="alert">{error}</p> : null}
    {member && member.role !== 'viewer' ? <form className="row" onSubmit={create}>
      <label htmlFor="campaign-title">New campaign</label><input id="campaign-title" value={title} onChange={e => setTitle(e.target.value)} required maxLength={150} placeholder="GTME waitlist launch" />
      <button className="btn primary" disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Start campaign'}</button>
    </form> : null}
    {loading ? <p role="status">Loading campaigns…</p> : !rows.length ? <p>No campaigns yet. Start one, then continue the planning conversation in Claude.</p> :
      <ul style={{ listStyle: 'none', padding: 0 }}>{rows.map(s => <li key={s.id} style={{ padding: '18px 0', borderBottom: '1px solid var(--border)' }}>
        <Link href={`/campaigns/${s.id}`}><strong>{s.title}</strong></Link> <span className="chip">{s.status.replaceAll('_',' ')}</span>
        <p className="muted">Revision {s.revision} · {s.brief?.channels.map(p => p.channel).join(' + ') || 'Memo in progress'}</p>
      </li>)}</ul>}
    {more ? <p>Showing the 100 most recently updated campaigns. Older records remain accessible by their campaign links.</p> : null}
  </section>;
}
