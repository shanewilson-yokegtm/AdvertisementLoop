'use client';
import Link from 'next/link';
import { useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { useRows, useSigned, useMembers, can, useInbox, FORMATS, frameLabel, type Asset, type Version, type Review } from '@/lib/data';
import { Thumb } from '@/components/Media';
import { useApp } from '@/components/Shell';
import Upload from '@/components/Upload';
import { statusChip, renderChip } from '@/components/Chips';
import { radioKeys, tab } from '@/lib/radio';

type Item = { a: Asset; v: Version; status: 'approved' | 'changes' | 'pending' };
type View = 'all' | 'feedback' | 'approved';
const fmt = (f: string) => FORMATS[f]?.label || f;

const SearchIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" strokeLinecap="round" /></svg>;

export default function Library() {
  const { member } = useApp(); const who = useMembers();
  const assets = useRows<Asset>('assets', { order: 'updated_at' });
  const versions = useRows<Version>('versions', { order: 'created_at' });
  const reviews = useRows<Review>('reviews');
  const [view, setView] = useState<View>('all'); const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [q, setQ] = useState(''); const [up, setUp] = useState(false);
  const isAdmin = member?.role === 'admin';
  // Feedback is personal by default: ads you own. Admins can deliberately widen it to every owner.
  const mine = useInbox('mine'); const everyone = useInbox('all', isAdmin);
  const inbox = scope === 'all' && isAdmin ? everyone : mine;
  const pendingFor = (id: string) => inbox.rows.find(r => r.asset_id === id)?.pending || 0;
  const latest: Record<string, Version> = {}; versions.rows.forEach(v => { if (!latest[v.asset_id] || latest[v.asset_id].version < v.version) latest[v.asset_id] = v; });
  const rev: Record<string, string> = Object.fromEntries(reviews.rows.map(r => [r.version_id, r.status]));
  const st = (v: Version) => rev[v.id] || 'pending';
  // One card per asset. Aspect-ratio variants share a title but are not linked by any stored identity yet,
  // so the Library never merges them by name (two owners can use the same title for unrelated ads).
  const items: Item[] = assets.rows.filter(a => latest[a.id]).map(a => ({ a, v: latest[a.id], status: st(latest[a.id]) as Item['status'] }))
    .sort((x, y) => +new Date(y.v.created_at) - +new Date(x.v.created_at));
  const live = items.filter(x => !x.a.archived), arch = items.filter(x => x.a.archived);
  const ownerOf = (x: Item) => who(x.a.owner_id, x.a.legacy_creator);
  const counts = { all: live.length, feedback: live.filter(x => pendingFor(x.a.id) > 0).length, approved: live.filter(x => x.status === 'approved').length };
  const needle = q.trim().toLowerCase();
  const shown = live.filter(x => (view === 'all' || (view === 'feedback' ? pendingFor(x.a.id) > 0 : x.status === 'approved'))
    && (!needle || x.a.concept_name.toLowerCase().includes(needle) || ownerOf(x).toLowerCase().includes(needle)));
  const urls = useSigned(items.flatMap(x => [x.v.poster_path || (x.v.content_type?.startsWith('image/') ? x.v.file_path : null)]));
  const download = async ({ a, v }: Item) => {
    if (!v.file_path) return;
    const name = `${a.concept_name.replace(/[^\w -]/g, '').trim().slice(0, 60)} ${frameLabel(v, a.format).replace(':', 'x')}.${v.file_path.split('.').pop()}`;
    const { data } = await sb().storage.from('ad-assets').createSignedUrl(v.file_path, 600, { download: name });
    if (!data?.signedUrl) return;
    const el = document.createElement('a'); el.href = data.signedUrl; el.rel = 'noopener'; document.body.appendChild(el); el.click(); el.remove();
  };
  const card = (x: Item) => { const { a, v } = x; const n = pendingFor(a.id);
    const title = a.concept_name.trim();
    return <article key={a.id} className="card" aria-label={`${title}, ${frameLabel(v, a.format)}`}>
      <Link className="cardlink" href={`/a/${a.id}`}>
        <div className="frame">
          <span className="badge">{renderChip(v) || statusChip(x.status)}</span>
          {n ? <span className="count" aria-label={`${n} feedback to decide`}>{n}</span> : null}
          <div className={`thumb ${a.format}`}><Thumb v={v} urls={urls} /></div>
        </div>
        <div className="meta"><div className="t">{title}</div><div className="sub">{ownerOf(x)} · {frameLabel(v, a.format)}</div></div>
      </Link>
      {x.status === 'approved' && v.file_path ? <div className="foot"><span className="muted small">v{v.version}</span>
        <button type="button" className="btn small" aria-label={`Download ${title}, ${frameLabel(v, a.format)}`} onClick={() => void download(x)}>Download</button></div> : null}
    </article>; };
  const err = assets.err || versions.err;
  const VIEWS: [View, string][] = [['all', 'All'], ['feedback', 'Feedback for you'], ['approved', 'Approved']];
  return <>
    <div className="head"><h1>Library</h1>
      {can(member, 'creator') ? <button className="btn ghost" onClick={() => setUp(true)}>Upload</button> : null}</div>
    {err ? <div className="banner err" style={{ marginBottom: 16 }}>Couldn&apos;t load the Library · {err}</div> : null}
    <div className="tools">
      <div className="seg" role="radiogroup" aria-label="Show" onKeyDown={radioKeys}>{VIEWS.map(([k, l]) =>
        <button key={k} type="button" role="radio" aria-checked={view === k} tabIndex={tab(view === k)} onClick={() => setView(k)}>{l}<span className="n">{counts[k]}</span></button>)}</div>
      {isAdmin && view === 'feedback' ? <div className="seg sm" role="radiogroup" aria-label="Whose feedback" onKeyDown={radioKeys}>
        {([['mine', 'Yours'], ['all', 'Everyone’s']] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={scope === k} tabIndex={tab(scope === k)} onClick={() => setScope(k)}>{l}</button>)}</div> : null}
      <label className="search"><span className="sr">Search concepts or owners</span><SearchIcon /><input type="search" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} /></label>
    </div>
    {view === 'feedback' ? <p className="hint" style={{ marginTop: -12, marginBottom: 20 }}>{scope === 'all' && isAdmin ? 'Every owner’s feedback waiting for a decision. Deciding keeps them as owner.' : 'Ads you own with feedback waiting for your approve or reject.'}</p> : null}
    {!assets.ready ? <div className="empty"><span className="muted">Loading</span></div>
      : !live.length ? <div className="empty"><h2>No ads yet</h2><span className="muted">Ads you make land here for the team to review.</span><Link className="btn primary" href="/create">Create an ad</Link></div>
      : !shown.length ? <div className="empty"><span className="muted">{needle ? `Nothing matches “${q.trim()}”` : view === 'feedback' ? 'No feedback waiting on you' : view === 'approved' ? 'Nothing approved yet' : 'Nothing here'}</span></div>
      : <div className="grid">{shown.map(card)}</div>}
    {arch.length ? <details className="disc" style={{ marginTop: 40 }}><summary>Rejected and archived<span className="muted">{arch.length}</span></summary>
      <div className="inner"><div className="grid">{arch.map(card)}</div></div></details> : null}
    {up ? <Upload onClose={() => setUp(false)} /> : null}
  </>;
}
