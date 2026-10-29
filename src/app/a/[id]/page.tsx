'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { useRows, useSigned, useMembers, can, canManage, fmtDate, fmtSec, fmtBytes, isVideo, FORMATS, KIND_LABEL, type Asset, type Version, type Review, type Comment } from '@/lib/data';
import { Player } from '@/components/Media';
import { statusChip, renderChip } from '@/components/Chips';
import { useApp } from '@/components/Shell';
import Upload from '@/components/Upload';
import Share from '@/components/Share';
import { approvalBlock, assetVersionPath } from '@/lib/creative-loop';
import { useRecorder, saveVoiceComment, RecordControl } from '@/components/VoiceNote';
import ProcessFeedback, { type Processing } from '@/components/Process';
import ChangeLog from '@/components/ChangeLog';

export default function AssetPage() {
  const { id } = useParams<{ id: string }>();
  return <Suspense fallback={<div className="empty">Loading</div>}><AssetDetail key={id} id={id} /></Suspense>;
}

function AssetDetail({ id }: { id: string }) {
  const router = useRouter(); const params = useSearchParams();
  const { member, toast } = useApp(); const who = useMembers();
  const assets = useRows<Asset>('assets', { filter: ['id', id] });
  const versions = useRows<Version>('versions', { filter: ['asset_id', id], order: 'version', asc: true });
  const reviews = useRows<Review>('reviews');
  const comments = useRows<Comment>('comments', { filter: ['asset_id', id], order: 'created_at', asc: true });
  const shares = useRows<any>('shares', { filter: ['asset_id', id], order: 'at' });
  const [sel, setSel] = useState<string | null>(null); const [up, setUp] = useState(false); const [share, setShare] = useState(false);
  const [note, setNote] = useState(''); const [cmt, setCmt] = useState(''); const [atHead, setAtHead] = useState(false);
  const a = assets.rows[0]; const vs = versions.rows; const latest = vs[vs.length - 1];
  const requested = params.get('v'); const selectedId = requested ?? sel;
  useEffect(() => { setNote(''); setCmt(''); setAtHead(false); setShare(false); }, [selectedId]);
  // Freeze the initial selection. Realtime updates must never change the version being reviewed.
  useEffect(() => { if (versions.ready && latest && !sel) setSel(latest.id); }, [versions.ready, latest?.id, sel]);
  const v = vs.find(x => x.id === selectedId);
  const urls = useSigned(v ? [v.file_path, v.poster_path] : []);
  const audioUrls = useSigned(comments.rows.map(c => c.audio_path));
  const jobs = useRows<any>('revision_jobs', { filter: ['asset_id', id], order: 'created_at' });
  const procs = useRows<Processing>('processing', { filter: ['asset_id', id], order: 'created_at', asc: true });
  const playhead = () => { const pv = document.getElementById('pv') as HTMLVideoElement | null; return pv ? Math.round(pv.currentTime * 10) / 10 : null; };
  // Voice is the primary way to review: the live transcript fills the note box, the audio is kept with it.
  const noteBase = useRef(''); const cmtBase = useRef('');
  const revRec = useRecorder({ playheadSec: playhead, toast, onText: t => setNote((noteBase.current ? noteBase.current + ' ' : '') + t) });
  const cmtRec = useRecorder({ playheadSec: playhead, toast, onText: t => setCmt((cmtBase.current ? cmtBase.current + ' ' : '') + t) });
  const [busy, setBusy] = useState(false);
  const selectVersion = (versionId: string) => {
    setNote(''); setCmt(''); setAtHead(false); setShare(false);
    router.replace(assetVersionPath(id, versionId), { scroll: false });
  };
  if (!assets.ready || !versions.ready || (latest && selectedId === null)) return <div className="empty"><span className="muted">Loading</span></div>;
  if (!a || !v) return <div className="empty"><h2>{requested !== null ? 'Version not found' : 'Not found'}</h2><Link className="btn" href="/">Back to Library</Link></div>;
  const rev = reviews.rows.find(r => r.version_id === v.id); const isLatest = v.id === latest?.id;
  const blockedApproval = approvalBlock(v);
  const src = v.source || {};
  const manage = canManage(member, a); const ownerName = who(a.owner_id, a.legacy_creator);
  const proc = procs.rows[procs.rows.length - 1] || null;

  const review = async (status: 'approved' | 'changes') => {
    if (status === 'approved' && blockedApproval) { toast(blockedApproval); return; }
    if (revRec.state === 'rec') { toast('Stop the recording first'); return; }
    setBusy(true);
    try {
      // Keep the spoken feedback (audio + transcript) with the version before the decision is recorded.
      if (note.trim() || revRec.take) await saveVoiceComment(a.id, v.id, revRec.take, note);
      const { error } = await sb().from('reviews').upsert({ version_id: v.id, status, note: note.trim() || null }, { onConflict: 'version_id' });
      if (error) throw error;
      setNote(''); noteBase.current = ''; revRec.clear();
      toast(status === 'approved' ? 'Approved' : `Changes requested · in ${manage && a.owner_id === member?.user_id ? 'your' : ownerName + '’s'} feedback to process`);
    } catch (e: any) { toast('Not saved · ' + (e?.message || e)); }
    setBusy(false);
  };
  // Reject: not worth fixing. The ad leaves the Library (archived, restorable) and queued revisions are cancelled.
  const reject = async () => {
    if (revRec.state === 'rec') revRec.stop();
    setBusy(true);
    const { error } = await sb().from('assets').update({ archived: true, archived_note: `Rejected by ${member?.display_name || 'a reviewer'}` }).eq('id', a.id);
    setBusy(false);
    if (error) { toast('Not saved · ' + error.message); return; }
    toast(`Rejected · ${a.concept_name} left the Library`); router.push('/');
  };
  const job = [...jobs.rows].reverse().find((j: any) => j.version_id === v.id && !j.processing_id) || null;
  const revert = async () => {
    if (!latest) return; setBusy(true);
    const { data, error } = await sb().rpc('revert_asset', { p_asset: a.id, p_from_version: v.id, p_expected_latest: latest.id });
    setBusy(false);
    if (error) { toast(/stale_parent/.test(error.message) ? 'A newer version was just saved. Reload and try again.' : 'Not reverted · ' + error.message); versions.reload(); return; }
    toast(`Reverted · v${(data as any).version} is a copy of v${v.version}`); versions.reload(); selectVersion((data as any).id);
  };
  const suggest = () => { const el = document.getElementById('cmt') as HTMLTextAreaElement | null; el?.focus(); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
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
        <div className="muted">{KIND_LABEL[a.kind]} · {FORMATS[a.format]?.label || a.format}{v.duration_sec ? ' · ' + fmtSec(v.duration_sec) : ''} · {who(v.created_by, v.legacy_creator)} · {fmtDate(v.created_at)} · Owner {ownerName}</div></div>
    </div>
    <div className="asset">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!isLatest && latest ? <div className="banner" role="status">You are viewing v{v.version}. A newer version is available. <button className="btn small" onClick={() => selectVersion(latest.id)}>View v{latest.version}</button>
          {manage ? <button className="btn small" disabled={busy} onClick={revert}>Revert to v{v.version}</button> : null}</div> : null}
        {vs.length > 1 ? <div className="vtabs" role="group" aria-label="Versions">{vs.map(x => <button key={x.id} aria-pressed={x.id === v.id} onClick={() => selectVersion(x.id)}>v{x.version}</button>)}</div> : null}
        <div className="preview"><Player v={v} urls={urls} /></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="row">{renderChip(v)}{statusChip(rev?.status || 'pending')}{!isLatest ? <span className="chip warn">Older version</span> : null}
          {rev ? <span className="muted">{rev.status === 'approved' ? 'Approved' : 'Changes requested'} by {who(rev.reviewer)} · {fmtDate(rev.at)}</span> : null}</div>
        {v.render?.note ? <div className="muted">{v.render.note}</div> : null}
        {v.revision_note ? <div><b>What changed: </b>{v.revision_note}</div> : null}
        <div className="row">
          <button className="btn primary" onClick={() => setShare(true)}>Share for review</button>
          {manage ? <button className="btn" onClick={iterate}>Iterate with Claude</button> : null}
          {manage ? <button className="btn" onClick={() => setUp(true)}>Upload new version</button> : null}
          {!manage && can(member, 'creator') ? <button className="btn" onClick={suggest}>Suggest a change</button> : null}
          {v.file_path ? <button className="btn" onClick={download}>Download</button> : null}
          {src.link ? <a className="btn" href={src.link} target="_blank" rel="noopener">Editable source</a> : null}
        </div>
        {can(member, 'approver') ? <div className="panel"><div className="row" style={{ justifyContent: 'space-between' }}><h3>Review v{v.version}</h3></div>
          {blockedApproval ? <p className="muted" role="status">{blockedApproval}</p> : null}
          <RecordControl r={{ ...revRec, start: () => { noteBase.current = note.trim(); return revRec.start(); } }} label="Record feedback" />
          <label className="sr" htmlFor="rev-note">What should change</label>
          <textarea id="rev-note" rows={3} placeholder="Talk or type what should change" value={note} onChange={e => setNote(e.target.value)} />
          <div className="row"><button className="btn primary" disabled={busy || revRec.state === 'rec' || !(note.trim() || revRec.take)} onClick={() => review('changes')}>Request changes</button>
            <button className="btn" disabled={busy || !!blockedApproval || rev?.status === 'approved'} onClick={() => review('approved')}>{rev?.status === 'approved' ? 'Approved' : 'Approve'}</button>
            {!a.archived && manage ? <button className="btn quiet-danger" disabled={busy} onClick={reject}>Reject ad</button> : null}</div>
          {job ? <JobStatus job={job} vs={vs} onOpen={selectVersion} /> : null}</div> : job ? <JobStatus job={job} vs={vs} onOpen={selectVersion} /> : null}
        {shares.rows.length ? <div className="muted">{shares.rows.slice(0, 3).map((s: any) => <div key={s.id}>Shared{s.channel ? ' to ' + s.channel : ''} by {who(s.shared_by)} · {fmtDate(s.at)}</div>)}</div> : null}
        {manage ? <ProcessFeedback a={a} vs={vs} comments={comments.rows} proc={proc} reload={() => { procs.reload(); comments.reload(); versions.reload(); }}
          who={who} audioUrls={audioUrls} toast={toast} onOpen={selectVersion} ownerName={ownerName} /> : null}
        <ChangeLog assetId={a.id} onOpen={selectVersion} refreshKey={`${vs.length}:${comments.rows.filter(c => c.status !== 'open').length}:${proc?.status || ''}`} />
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><h2>{manage ? 'Comment history' : 'Feedback'}</h2>
          {/* Owners decide on open comments above; here they see what was accepted/ignored. Everyone else sees the full thread. */}
          {(() => { const list = manage ? comments.rows.filter(c => c.status !== 'open') : comments.rows; return !list.length ? <div className="muted">{manage ? 'Nothing decided yet' : 'No comments yet'}</div> : list.map(c => { const cv = vs.find(x => x.id === c.version_id);
            return <div className="cmt" key={c.id}><div className="row"><b>{who(c.author, c.legacy_author)}</b><span className="muted">v{cv?.version ?? '?'}{c.at_sec != null ? ' · at ' + fmtSec(c.at_sec) : ''} · {fmtDate(c.created_at)}</span>
              {c.status === 'applied' ? <span className="chip ok">Accepted{c.applied_in ? ' in v' + (vs.find(x => x.id === c.applied_in)?.version ?? '?') : ''}</span> : c.status === 'dismissed' ? <span className="chip">Ignored</span> : <span className="chip warn">Open</span>}</div>
              {c.audio_path ? <audio controls preload="none" src={audioUrls[c.audio_path]} style={{ width: '100%' }} aria-label={`Voice note from ${who(c.author, c.legacy_author)}`} /> : null}
              {c.audio_path && c.body === 'Voice note' ? null : <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>}
              {c.resolution_note ? <div className="muted">{c.status === 'dismissed' ? 'Reason: ' : 'Note: '}{c.resolution_note}</div> : null}
              {c.deleted_at ? <div className="muted">Deleted in Slack (kept for history)</div> : c.edited_at ? <div className="muted">Edited in Slack</div> : null}
              {c.source_link ? <a className="muted" href={c.source_link} target="_blank" rel="noopener">View in Slack</a> : null}</div>; }); })()}
          {can(member, 'creator') ? <form className="panel" onSubmit={async e => { e.preventDefault(); const t = cmt.trim(); if (!t && !cmtRec.take) return;
              if (cmtRec.state === 'rec') { toast('Stop the recording first'); return; }
              try {
                if (cmtRec.take) await saveVoiceComment(a.id, v.id, cmtRec.take, t);
                else { const pv = document.getElementById('pv') as HTMLVideoElement | null;
                  const { error } = await sb().from('comments').insert({ asset_id: a.id, version_id: v.id, body: t, at_sec: isVideo(v) && atHead && pv ? Math.round(pv.currentTime * 10) / 10 : null }); if (error) throw error; }
                setCmt(''); cmtBase.current = ''; cmtRec.clear(); toast('Comment added');
              } catch (err: any) { toast('Not saved · ' + (err?.message || err)); } }}>
            <RecordControl r={{ ...cmtRec, start: () => { cmtBase.current = cmt.trim(); return cmtRec.start(); } }} label="Record a comment" />
            <label className="sr" htmlFor="cmt">Comment</label><textarea id="cmt" rows={2} placeholder="Talk or type a comment" value={cmt} onChange={e => setCmt(e.target.value)} />
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
            {manage ? <div><button className="btn small" onClick={async () => { const { error } = await sb().from('assets').update({ archived: !a.archived }).eq('id', a.id); toast(error ? error.message : a.archived ? 'Restored' : 'Archived'); }}>{a.archived ? 'Restore from archive' : 'Archive'}</button></div> : null}
          </div></details>
      </div>
    </div>
    {up ? <Upload asset={a} onClose={() => setUp(false)} /> : null}
    {share ? <Share a={a} v={v} onClose={() => setShare(false)} /> : null}
  </>;
}

const JOB_TEXT: Record<string, string> = {
  queued: 'Queued · Claude starts within the hour', working: 'Claude is making the next version',
  done: 'Next version ready', needs_input: 'Claude needs your input', failed: 'Revision failed', cancelled: 'Cancelled',
};
function JobStatus({ job, vs, onOpen }: { job: any; vs: Version[]; onOpen: (id: string) => void }) {
  const out = job.result_version_id ? vs.find(x => x.id === job.result_version_id) : null;
  return <div className="row" role="status">
    <span className={'chip ' + (job.state === 'done' ? 'ok' : job.state === 'failed' || job.state === 'needs_input' ? 'warn' : '')}>{JOB_TEXT[job.state] || job.state}</span>
    {job.state === 'working' && job.claimed_at ? <span className="muted">since {fmtDate(job.claimed_at)}</span> : null}
    {out ? <button className="btn small" onClick={() => onOpen(out.id)}>View v{out.version}</button> : null}
    {job.message ? <span className="muted" style={{ flexBasis: '100%' }}>{job.message}</span> : null}
    {job.session_url && job.state !== 'done' ? <a className="muted" href={job.session_url} target="_blank" rel="noopener">Open Claude session</a> : null}
  </div>;
}
