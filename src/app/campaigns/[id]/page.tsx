'use client';
import Link from 'next/link';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/Shell';
import CampaignView from '@/components/campaigns/CampaignView';

export default function Campaign({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const { member } = useApp();
  const [data, setData] = useState<any>(null); const [audit, setAudit] = useState<any>(null);
  const [performance, setPerformance] = useState<any>(null); const [closeout, setCloseout] = useState<any>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [groupBy, setGroupBy] = useState('concept'); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const pending = useRef<{ key: string; body: unknown } | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const root = `/api/campaigns/${encodeURIComponent(id)}`;
    const results = await Promise.all(['','/observations','/closeout'].map(async suffix => {
      const r = await fetch(root + suffix, { cache: 'no-store', signal }); const d = await r.json();
      if (!r.ok) throw new Error(d.message || 'Campaign could not be loaded'); return d;
    }));
    setData(results[0]); setAudit(results[1]); setCloseout(results[2]);
  },[id]);
  useEffect(() => { const c = new AbortController(); setData(null); setError(''); pending.current = null;
    load(c.signal).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => c.abort(); },[load]);
  useEffect(() => {
    const c = new AbortController(); setPerformance(null);
    const query = new URLSearchParams({groupBy,...(from ? {from} : {}),...(to ? {to} : {})});
    fetch(`/api/campaigns/${encodeURIComponent(id)}/report?${query}`,{signal:c.signal,cache:'no-store'}).then(async r => {
      const d = await r.json(); if (!r.ok) throw new Error(d.message || 'Performance unavailable'); setPerformance(d);
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => c.abort();
  },[id,groupBy,from,to,data?.state.revision]);
  async function command(command: Record<string,unknown>) {
    if (!data || busy) return; setBusy(true); setError('');
    const request = pending.current || { key: crypto.randomUUID(), body: { expectedRevision: data.state.revision, command } }; pending.current = request;
    try {
      const r = await fetch(`/api/campaigns/${encodeURIComponent(id)}/commands`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...(request.body as object), requestKey:request.key }) });
      const result = await r.json();
      if (!r.ok) { if (r.status < 500) pending.current = null; throw new Error(result.message || 'Could not save'); }
      pending.current = null; await load();
    } catch(e) { setError(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  }
  return <><Link href="/campaigns">← Campaigns</Link>
    {error ? <p role="alert">{error} <button className="btn small" onClick={() => load().then(() => setError('')).catch(e => setError(e.message))}>Reload</button></p> : null}
    {data ? <CampaignView state={data.state} memo={data.memo} fingerprint={data.fingerprint} canApprove={member?.role === 'admin' || member?.role === 'approver'} pending={busy} onCommand={command} audit={audit} performance={performance} closeout={closeout}
      groupBy={groupBy} onGroupBy={setGroupBy} from={from} to={to} onFrom={setFrom} onTo={setTo} /> : !error ? <p role="status">Loading campaign…</p> : null}
  </>;
}
