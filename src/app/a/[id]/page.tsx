'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { useRows, useSigned, useMembers, can, fmtDate, fmtSec, fmtBytes, isVideo, FORMATS, KIND_LABEL, type Asset, type Version, type Review, type Comment } from '@/lib/data';
import { Player } from '@/components/Media';
import { statusChip, renderChip } from '@/components/Chips';
import { useApp } from '@/components/Shell';
import Upload from '@/components/Upload';
import Share from '@/components/Share';

export default function AssetPage() {
  const { id } = useParams<{ id: string }>(); const router = useRouter();
  const { member, toast } = useApp(); const who = useMembers();
  const assets = useRows<Asset>('assets', { filter: ['id', id] });
  const versions = useRows<Version>('versions', { filter: ['asset_id', id], order: 'version', asc: true });
  const reviews = useRows<Review>('reviews');
  const comments = useRows<Comment>('comments', { filter: ['asset_id', id], order: 'created_at', asc: true });
  const shares = useRows<any>('shares', { filter: ['asset_id', id], order: 'at' });
  const [sel, setSel] = useState<string | null>(null); const [up, setUp] = useState(false); const [share, setShare] = useState(false);
  const [note, setNote] = useState(''); const [cmt, setCmt] = useState(''); const [atHead, setAtHead] = useState(false);
  const a = assets.rows[0]; const vs = versions.rows; const v = vs.find(x => x.id === sel) || vs[vs.length - 1];
  const urls = useSigned(v ? [v.file_path, v.poster_path] : []);
  if (!assets.ready || !versions.ready) return <div className="empty"><span className="muted">Loading</span></div>;
  if (!a || !v) return <div className="empty"><h2>Not found</h2><Link className="btn" href="/">Back to Library</Link></div>;
  const rev = reviews.rows.find(r => r.version_id === v.id); const isLatest = v === vs[vs.length - 1];
  const failQA = (v.qa || []).some((q: any) => q.status === 'fail');
  const src = v.source || {};

  const review = async (status: 'approved' | 'changes') => {
    const { error } = await sb().from('reviews').upsert({ version_id: v.id, status, note: note.trim() || null }, { onConflict: 'version_id' });
    if (error) { toast('Not saved · ' + error.message); return; }
    if (status === 'changes' && note.trim()) await sb().from('comments').insert({ asset_id: a.id, version_id: v.id, body: note.trim() });
    setNote(''); toast(status === 'approved' ? 'Approved' : 'Changes requested');
  };
  const iterate = async () => {
    const { data: ex } = await sb().from('chats').select('id').eq('asset_id', a.id).order('updated_at', { ascending: false }).limit(1);
    if (ex && ex[0]) { router.push(`/create/${ex[0].id}`); return; }
    const { data, error } = await sb().from('chats').insert({ title: a.concept_name, asset_id: a.id, created_by: member!.user_id, create_type: a.kind === 'static' ? 'static' : a.kind === 'motion' ? 'motion' : 'higgsfield' }).select('id').single();
    if (error) toast('Couldn’t start · ' + error.message); else router.push(`/create/${data.id}`);
  };
  const download = async () => {
    if (!v.file_path) return;
    const ext = v.file_path.split('.').pop();
    const { data } = await sb().storage.from('ad-assets').createSignedUrl(v.file_path, 600, { download: `${a.concept_name.replace(/[^\w -]/g, '').slice(0, 60)}-v${v.version}.${ext}` });
    if (data?.signedUrl) location.href = data.signedUrl;
  };

  return <>
    <div className="head" style={{ alignItems: 'flex-start' }}>
      <div style={{ minWidth: 0 }}><Link href="/" className="muted">← Library</Link><h1>{a.concept_name}</h1>
        <div className="muted">{KIND_LABEL[a.kind]} · {FORMATS[a.format]?.label || a.format}{v.duration_sec ? ' · ' + fmtSec(v.duration_sec) : ''} · {who(v.created_by, v.legacy_creator)} · {fmtDate(v.created_at)}</div></div>
    </div>
    <div className="asset">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {vs.length > 1 ? <div className="vtabs" role="group" aria-label="Versions">{vs.map(x => <button key={x.id} aria-pressed={x.id === v.id} onClick={() => setSel(x.id)}>v{x.version}</button>)}</div> : null}
        <div className="preview"><Player v={v} urls={urls} /></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="row">{renderChip(v)}{statusChip(rev?.status || 'pending')}{!isLatest ? <span className="chip warn">Older version</span> : null}
          {rev ? <span className="muted">{rev.status === 'approved' ? 'Approved' : 'Changes requested'} by {who(rev.reviewer)} · {fmtDate(rev.at)}</span> : null}</div>
        {v.render?.note ? <div className="muted">{v.render.note}</div> : null}
        {v.revision_note ? <div><b>What changed: </b>{v.revision_note}</div> : null}
        <div className="row">
          <button className="btn primary" onClick={() => setShare(true)}>Share for review</button>
          {can(member, 'creator') ? <button className="btn" onClick={iterate}>Iterate with Claude</button> : null}
          {can(member, 'creator') ? <button className="btn" onClick={() => setUp(true)}>Upload new version</button> : null}
          {v.file_path ? <button className="btn" onClick={download}>Download</button> : null}
          {src.link ? <a className="btn" href={src.link} target="_blank" rel="noopener">Editable source</a> : null}
        </div>
        {can(member, 'approver') ? <div className="panel"><div className="row" style={{ justifyContent: 'space-between' }}><h3>Review</h3>{failQA ? <span className="chip warn">Fix failed checks</span> : null}</div>
          <textarea rows={2} placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
          <div className="row"><button className="btn primary" disabled={failQA || rev?.status === 'approved'} onClick={() => review('approved')}>{rev?.status === 'approved' ? 'Approved' : 'Approve'}</button>
            <button className="btn" disabled={rev?.status === 'changes' && !note.trim()} onClick={() => review('changes')}>Request changes</button></div></div> : null}
        {shares.rows.length ? <div className="muted">{shares.rows.slice(0, 3).map((s: any) => <div key={s.id}>Shared{s.channel ? ' to ' + s.channel : ''} by {who(s.shared_by)} · {fmtDate(s.at)}</div>)}</div> : null}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><h2>Feedback</h2>
          {!comments.rows.length ? <div className="muted">No comments yet</div> : comments.rows.map(c => { const cv = vs.find(x => x.id === c.version_id);
            return <div className="cmt" key={c.id}><div className="row"><b>{who(c.author, c.legacy_author)}</b><span className="muted">v{cv?.version ?? '?'}{c.at_sec != null ? ' · at ' + fmtSec(c.at_sec) : ''} · {fmtDate(c.created_at)}</span>
              {c.status === 'applied' ? <span className="chip ok">Applied</span> : c.status === 'dismissed' ? <span className="chip">Dismissed</span> : <span className="chip warn">Open</span>}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
              {c.status === 'open' && can(member, 'creator') ? <div><button className="btn small" onClick={async () => { const { error } = await sb().from('comments').update({ status: 'dismissed' }).eq('id', c.id); if (error) toast(error.message); }}>Dismiss</button></div> : null}</div>; })}
          {can(member, 'creator') ? <form className="panel" onSubmit={async e => { e.preventDefault(); const t = cmt.trim(); if (!t) return;
              const pv = document.getElementById('pv') as HTMLVideoElement | null;
              const { error } = await sb().from('comments').insert({ asset_id: a.id, version_id: v.id, body: t, at_sec: isVideo(v) && atHead && pv ? Math.round(pv.currentTime * 10) / 10 : null });
              if (error) toast('Not saved · ' + error.message); else { setCmt(''); toast('Comment added'); } }}>
            <label className="sr" htmlFor="cmt">Comment</label><textarea id="cmt" rows={2} placeholder="Headline too long on 9:16" value={cmt} onChange={e => setCmt(e.target.value)} />
            <div className="row" style={{ justifyContent: 'space-between' }}>{isVideo(v) ? <label className="row"><input type="checkbox" checked={atHead} onChange={e => setAtHead(e.target.checked)} /> At playhead</label> : <span />}<button className="btn primary">Comment</button></div>
          </form> : null}
        </section>
        <details><summary style={{ cursor: 'pointer', fontWeight: 650 }}>Copy, checks and file</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
            <div className="tbl"><table><tbody>
              {(v.copy?.primaryText || []).map((t: string, i: number) => <tr key={'p' + i}><th>Primary</th><td>{t}</td></tr>)}
              {(v.copy?.headlines || []).map((t: string, i: number) => <tr key={'h' + i}><th>Headline</th><td>{t}</td></tr>)}
              <tr><th>CTA</th><td>{v.copy?.cta || '--'}</td></tr><tr><th>Destination</th><td>{v.copy?.destination || 'Not set'}</td></tr></tbody></table></div>
            {(v.qa || []).length ? <div className="qa">{v.qa.map((q: any, i: number) => <div key={i}><span className={'chip ' + (q.status === 'pass' ? 'ok' : q.status === 'warn' ? 'warn' : 'err')}>{q.status === 'pass' ? 'Pass' : q.status === 'warn' ? 'Warn' : 'Fail'}</span><b>{q.check}</b><span className="muted">{q.note}</span></div>)}</div> : null}
            <dl className="kv"><dt>Version</dt><dd>v{v.version}{v.parent_version_id ? ' from v' + (vs.find(x => x.id === v.parent_version_id)?.version ?? '?') : ''}</dd>
              <dt>Made with</dt><dd>{src.tool || '--'}{src.model ? ' · ' + src.model : ''}</dd><dt>Notes</dt><dd>{src.prompt || '--'}</dd>
              <dt>File</dt><dd>{v.width}×{v.height}{v.duration_sec ? ' · ' + fmtSec(v.duration_sec) : ''} · {fmtBytes(v.size_bytes)} · {v.content_type || '--'}</dd>
              <dt>SHA-256</dt><dd className="mono">{(v.sha256 || '').slice(0, 16)}…</dd><dt>ID</dt><dd className="mono">{v.id}</dd></dl>
            {can(member, 'creator') ? <div><button className="btn small" onClick={async () => { const { error } = await sb().from('assets').update({ archived: !a.archived }).eq('id', a.id); toast(error ? error.message : a.archived ? 'Restored' : 'Archived'); }}>{a.archived ? 'Restore from archive' : 'Archive'}</button></div> : null}
          </div></details>
      </div>
    </div>
    {up ? <Upload asset={a} onClose={() => setUp(false)} /> : null}
    {share ? <Share a={a} v={v} onClose={() => setShare(false)} /> : null}
  </>;
}
