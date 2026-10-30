'use client';
import Link from 'next/link';
import { useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { useRows, useSigned, can, useInbox, FORMATS, KIND_LABEL, type Asset, type Version, type Review, type Comment } from '@/lib/data';
import { Thumb } from '@/components/Media';
import { useApp } from '@/components/Shell';
import Upload from '@/components/Upload';
import { statusChip, renderChip } from '@/components/Chips';

type Item = { a: Asset; v: Version };
type Concept = { key: string; fs: Item[]; status: 'approved' | 'changes' | 'pending'; at: number };
const ORDER = ['vertical', 'feed45', 'square', 'landscape'];

export default function Library() {
  const { member } = useApp();
  const assets = useRows<Asset>('assets', { order: 'updated_at' });
  const versions = useRows<Version>('versions', { order: 'created_at' });
  const reviews = useRows<Review>('reviews');
  const comments = useRows<Comment>('comments');
  const [f, setF] = useState<'all' | 'inbox' | 'everyone' | 'pending' | 'changes' | 'approved'>('all'); const [up, setUp] = useState(false);
  const isAdmin = member?.role === 'admin';
  const mine = useInbox('mine'); const everyone = useInbox('all', isAdmin);
  const pendingFor = (id: string) => (f === 'everyone' ? everyone : mine).rows.find(r => r.asset_id === id)?.pending || 0;
  const latest: Record<string, Version> = {}; versions.rows.forEach(v => { if (!latest[v.asset_id] || latest[v.asset_id].version < v.version) latest[v.asset_id] = v; });
  const rev: Record<string, string> = Object.fromEntries(reviews.rows.map(r => [r.version_id, r.status]));
  const st = (v: Version) => rev[v.id] || 'pending';
  // The Library is one card per concept. Each format is its own ad underneath; versions stay on the ad page.
  const items = assets.rows.filter(a => latest[a.id]).map(a => ({ a, v: latest[a.id] }));
  const concepts = (list: Item[]) => {
    const by = new Map<string, Item[]>();
    for (const x of list) { const k = x.a.kind + '|' + x.a.concept_name.trim().toLowerCase(); by.set(k, [...(by.get(k) || []), x]); }
    return [...by.entries()].map(([key, fs]) => {
      fs.sort((x, y) => ORDER.indexOf(x.a.format) - ORDER.indexOf(y.a.format));
      const sts = fs.map(x => st(x.v));
      const status = sts.every(s => s === 'approved') ? 'approved' : sts.includes('changes') ? 'changes' : 'pending';
      return { key, fs, status, at: Math.max(...fs.map(x => +new Date(x.v.created_at))) } as Concept;
    }).sort((x, y) => y.at - x.at);
  };
  const live = concepts(items.filter(x => !x.a.archived)), arch = concepts(items.filter(x => x.a.archived));
  const inMine = new Set(mine.rows.map(r => r.asset_id)), inAll = new Set(everyone.rows.map(r => r.asset_id));
  const has = (c: Concept, set: Set<string>) => c.fs.some(x => set.has(x.a.id));
  const counts = { all: live.length, inbox: live.filter(c => has(c, inMine)).length, everyone: live.filter(c => has(c, inAll)).length, pending: live.filter(c => c.status === 'pending').length, changes: live.filter(c => c.status === 'changes').length, approved: live.filter(c => c.status === 'approved').length };
  const shown = live.filter(c => f === 'all' || (f === 'inbox' ? has(c, inMine) : f === 'everyone' ? has(c, inAll) : c.status === f));
  const urls = useSigned(items.flatMap(x => [x.v.poster_path || (x.v.content_type?.startsWith('image/') ? x.v.file_path : null)]));
  const openC = (c: Concept) => comments.rows.filter(m => c.fs.some(x => x.a.id === m.asset_id) && m.status === 'open').length;
  const pendingC = (c: Concept) => c.fs.reduce((n, x) => n + pendingFor(x.a.id), 0);
  const download = async (fs: Item[]) => {
    for (const { a, v } of fs) {
      if (!v.file_path) continue;
      const name = `${a.concept_name.replace(/[^\w -]/g, '').trim().slice(0, 60)} ${FORMATS[a.format]?.label.replace(':', 'x') || a.format}.${v.file_path.split('.').pop()}`;
      const { data } = await sb().storage.from('ad-assets').createSignedUrl(v.file_path, 600, { download: name });
      if (!data?.signedUrl) continue;
      const el = document.createElement('a'); el.href = data.signedUrl; el.rel = 'noopener'; document.body.appendChild(el); el.click(); el.remove();
      await new Promise(r => setTimeout(r, 400)); // browsers drop back-to-back downloads
    }
  };
  const card = (c: Concept) => { const { a, v } = c.fs[0]; const n = pendingC(c), o = openC(c);
    return <div key={c.key} className="card">
      <Link className="cardlink" href={`/a/${a.id}`}>
        <div className={`thumb ${a.format}`}><Thumb v={v} urls={urls} /></div>
        <div className="body"><div className="t">{a.concept_name.trim()}</div>
          <div className="row">{renderChip(v) || statusChip(c.status)}
            {n ? <span className="chip warn">Feedback · {n}</span> : o ? <span className="chip">Feedback · {o}</span> : null}</div></div>
      </Link>
      <div className="body formats">
        <div className="row" aria-label="Formats">{c.fs.map(x => <Link key={x.a.id} className="chip" href={`/a/${x.a.id}`}>{FORMATS[x.a.format]?.label || x.a.format}</Link>)}</div>
        {c.status === 'approved' ? <div className="row">
          {c.fs.length > 1 ? <button className="btn small primary" onClick={() => download(c.fs)}>Download all</button> : null}
          {c.fs.map(x => <button key={x.a.id} className="btn small" onClick={() => download([x])}>{FORMATS[x.a.format]?.label || x.a.format}</button>)}
        </div> : null}
      </div>
    </div>; };
  const err = assets.err || versions.err;
  return <>
    <div className="head"><h1>Library</h1><div className="row">
      {can(member, 'creator') ? <button className="btn" onClick={() => setUp(true)}>Upload</button> : null}
      <Link className="btn primary" href="/create">Create an ad</Link></div></div>
    {err ? <div className="banner err" style={{ marginBottom: 16 }}>Couldn&apos;t load the Library · {err}</div> : null}
    <div className="tabs" role="group" aria-label="Filter">{([['all', 'All'], ['inbox', 'Feedback to process'], ...(isAdmin ? [['everyone', 'Everyone’s feedback']] as const : []), ['pending', 'Needs review'], ['changes', 'Changes requested'], ['approved', 'Approved']] as const).map(([k, l]) =>
      <button key={k} aria-pressed={f === k} onClick={() => setF(k)}>{l} · {counts[k]}</button>)}</div>
    {f === 'approved' ? <p className="muted">Every format of these concepts is approved. Download one format or all.</p> : f === 'inbox' ? <p className="muted">Concepts you own with feedback to decide. Open one and process it.</p> : f === 'everyone' ? <p className="muted">Admin view: every owner’s pending feedback. Processing someone else’s ad keeps them as owner.</p> : null}
    {!assets.ready ? <div className="empty"><span className="muted">Loading</span></div>
      : !live.length ? <div className="empty"><h2>No ads yet</h2><Link className="btn primary" href="/create">Create an ad</Link></div>
      : !shown.length ? <div className="empty"><span className="muted">Nothing here</span></div>
      : <div className="grid">{shown.map(card)}</div>}
    {arch.length ? <details style={{ marginTop: 32 }}><summary className="muted" style={{ cursor: 'pointer', fontWeight: 600 }}>Rejected and archived · {arch.length}</summary>
      <p className="muted">Earlier concepts kept for reference.</p><div className="grid">{arch.map(card)}</div></details> : null}
    {up ? <Upload onClose={() => setUp(false)} /> : null}
  </>;
}
