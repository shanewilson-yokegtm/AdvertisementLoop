'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRows, useSigned, can, useInbox, FORMATS, KIND_LABEL, type Asset, type Version, type Review, type Comment } from '@/lib/data';
import { Thumb } from '@/components/Media';
import { useApp } from '@/components/Shell';
import Upload from '@/components/Upload';
import { statusChip, renderChip } from '@/components/Chips';

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
  const items = assets.rows.filter(a => latest[a.id]).map(a => ({ a, v: latest[a.id] }));
  const live = items.filter(x => !x.a.archived).sort((x, y) => +new Date(y.v.created_at) - +new Date(x.v.created_at));
  const arch = items.filter(x => x.a.archived);
  const inMine = new Set(mine.rows.map(r => r.asset_id)), inAll = new Set(everyone.rows.map(r => r.asset_id));
  const counts = { all: live.length, inbox: mine.rows.length, everyone: everyone.rows.length, pending: live.filter(x => st(x.v) === 'pending').length, changes: live.filter(x => st(x.v) === 'changes').length, approved: live.filter(x => st(x.v) === 'approved').length };
  const shown = live.filter(x => f === 'all' || (f === 'inbox' ? inMine.has(x.a.id) : f === 'everyone' ? inAll.has(x.a.id) : st(x.v) === f));
  const urls = useSigned(items.flatMap(x => [x.v.poster_path || (x.v.content_type?.startsWith('image/') ? x.v.file_path : null)]));
  const openC = (id: string) => comments.rows.filter(c => c.asset_id === id && c.status === 'open').length;
  const card = ({ a, v }: { a: Asset; v: Version }) => (
    <Link key={a.id} className="card" href={`/a/${a.id}`}>
      <div className={`thumb ${a.format}`}><Thumb v={v} urls={urls} /></div>
      <div className="body"><div className="t">{a.concept_name}</div>
        <div className="muted">{KIND_LABEL[a.kind]} · {FORMATS[a.format]?.label || a.format} · v{v.version}</div>
        <div className="row">{renderChip(v) || statusChip(st(v))}
          {pendingFor(a.id) ? <span className="chip warn">Feedback to process · {pendingFor(a.id)}</span>
            : openC(a.id) ? <span className="chip">{openC(a.id)} comment{openC(a.id) > 1 ? 's' : ''}</span> : null}</div></div>
    </Link>);
  const err = assets.err || versions.err;
  return <>
    <div className="head"><h1>Library</h1><div className="row">
      {can(member, 'creator') ? <button className="btn" onClick={() => setUp(true)}>Upload</button> : null}
      <Link className="btn primary" href="/create">Create an ad</Link></div></div>
    {err ? <div className="banner err" style={{ marginBottom: 16 }}>Couldn&apos;t load the Library · {err}</div> : null}
    <div className="tabs" role="group" aria-label="Filter">{([['all', 'All'], ['inbox', 'Feedback to process'], ...(isAdmin ? [['everyone', 'Everyone’s feedback']] as const : []), ['pending', 'Needs review'], ['changes', 'Changes requested'], ['approved', 'Approved']] as const).map(([k, l]) =>
      <button key={k} aria-pressed={f === k} onClick={() => setF(k)}>{l} · {counts[k]}</button>)}</div>
    {f === 'inbox' ? <p className="muted">Ads you own with open feedback. Open one and press Process feedback.</p> : f === 'everyone' ? <p className="muted">Admin view: every owner’s pending feedback. Processing someone else’s ad keeps them as owner.</p> : null}
    {!assets.ready ? <div className="empty"><span className="muted">Loading</span></div>
      : !live.length ? <div className="empty"><h2>No ads yet</h2><Link className="btn primary" href="/create">Create an ad</Link></div>
      : !shown.length ? <div className="empty"><span className="muted">Nothing here</span></div>
      : <div className="grid">{shown.map(card)}</div>}
    {arch.length ? <details style={{ marginTop: 32 }}><summary className="muted" style={{ cursor: 'pointer', fontWeight: 600 }}>Rejected and archived · {arch.length}</summary>
      <p className="muted">Earlier concepts kept for reference.</p><div className="grid">{arch.map(card)}</div></details> : null}
    {up ? <Upload onClose={() => setUp(false)} /> : null}
  </>;
}
