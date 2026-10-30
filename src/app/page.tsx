'use client';
import Link from 'next/link';
import { useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { useRows, useSigned, useMembers, can, useInbox, FORMATS, type Asset, type Version, type Review } from '@/lib/data';
import { Thumb } from '@/components/Media';
import { useApp } from '@/components/Shell';
import Upload from '@/components/Upload';
import { statusChip, renderChip } from '@/components/Chips';
import { radioKeys, tab } from '@/lib/radio';

type Item = { a: Asset; v: Version };
type Concept = { key: string; fs: Item[]; status: 'approved' | 'changes' | 'pending'; at: number };
type View = 'all' | 'feedback' | 'approved';
const ORDER = ['vertical', 'feed45', 'square', 'landscape'];
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
  // One card per concept. Each aspect ratio is its own ad underneath; versions live on the ad page.
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
  const owners = (c: Concept) => [...new Set(c.fs.map(x => who(x.a.owner_id, x.a.legacy_creator)))].join(', ');
  const pendingC = (c: Concept) => c.fs.reduce((n, x) => n + pendingFor(x.a.id), 0);
  const counts = { all: live.length, feedback: live.filter(c => pendingC(c) > 0).length, approved: live.filter(c => c.status === 'approved').length };
  const needle = q.trim().toLowerCase();
  const shown = live.filter(c => (view === 'all' || (view === 'feedback' ? pendingC(c) > 0 : c.status === 'approved'))
    && (!needle || c.fs[0].a.concept_name.toLowerCase().includes(needle) || owners(c).toLowerCase().includes(needle)));
  const urls = useSigned(items.flatMap(x => [x.v.poster_path || (x.v.content_type?.startsWith('image/') ? x.v.file_path : null)]));
  const download = async (fs: Item[]) => {
    for (const { a, v } of fs) {
      if (!v.file_path) continue;
      const name = `${a.concept_name.replace(/[^\w -]/g, '').trim().slice(0, 60)} ${fmt(a.format).replace(':', 'x')}.${v.file_path.split('.').pop()}`;
      const { data } = await sb().storage.from('ad-assets').createSignedUrl(v.file_path, 600, { download: name });
      if (!data?.signedUrl) continue;
      const el = document.createElement('a'); el.href = data.signedUrl; el.rel = 'noopener'; document.body.appendChild(el); el.click(); el.remove();
      await new Promise(r => setTimeout(r, 400)); // browsers drop back-to-back downloads
    }
  };
  const closeMenu = (e: React.MouseEvent) => { const d = (e.currentTarget as HTMLElement).closest('details'); if (d) d.open = false; };
  const card = (c: Concept) => { const { a, v } = c.fs[0]; const n = pendingC(c);
    const title = a.concept_name.trim();
    return <article key={c.key} className="card" aria-label={title}>
      <Link className="cardlink" href={`/a/${a.id}`}>
        <div className="frame">
          <span className="badge">{renderChip(v) || statusChip(c.status)}</span>
          {n ? <span className="count" aria-label={`${n} feedback to decide`}>{n}</span> : null}
          <div className={`thumb ${a.format}`}><Thumb v={v} urls={urls} /></div>
        </div>
        <div className="meta"><div className="t">{title}</div><div className="sub">{owners(c)}</div></div>
      </Link>
      <div className="foot">
        <div className="fmts" aria-label="Formats">{c.fs.map(x => <Link key={x.a.id} href={`/a/${x.a.id}`} aria-label={`${title}, ${fmt(x.a.format)}`}>{fmt(x.a.format)}</Link>)}</div>
        {c.status === 'approved' && c.fs.some(x => x.v.file_path) ? <details className="dd">
          <summary className="btn small" aria-label={`Download ${title}`}>Download</summary>
          <div className="menu" role="menu">
            {c.fs.length > 1 ? <button role="menuitem" type="button" className="mi" onClick={e => { closeMenu(e); void download(c.fs); }}>Download all<span className="muted">{c.fs.length} files</span></button> : null}
            {c.fs.map(x => <button role="menuitem" type="button" key={x.a.id} className="mi" onClick={e => { closeMenu(e); void download([x]); }}>{fmt(x.a.format)}</button>)}
          </div></details> : null}
      </div>
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
