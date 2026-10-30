'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { useRows, useSigned, useMembers, can, canManage, fmtDate, fmtSec, fmtBytes, isVideo, frameLabel, KIND_LABEL, type Asset, type Version, type Review, type Comment } from '@/lib/data';
import { Player } from '@/components/Media';
import { statusChip, renderChip } from '@/components/Chips';
import { useApp } from '@/components/Shell';
import Share from '@/components/Share';
import { approvalBlock, assetVersionPath } from '@/lib/creative-loop';
import { useRecorder, saveVoiceComment, RecordControl } from '@/components/VoiceNote';
import ProcessFeedback, { activeProcessing, type Processing } from '@/components/Process';
import FeedbackThread, { PreviousRuns } from '@/components/FeedbackThread';
import { useHiggsfieldPoll } from '@/components/Higgsfield';

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
  const [sel, setSel] = useState<string | null>(null); const [share, setShare] = useState(false);
  const [cmt, setCmt] = useState(''); const [atHead, setAtHead] = useState(false);
  const a = assets.rows[0]; const vs = versions.rows; const latest = vs[vs.length - 1];
  const requested = params.get('v'); const selectedId = requested ?? sel;
  useEffect(() => { setCmt(''); setAtHead(false); setShare(false); }, [selectedId]);
  // Freeze the initial selection. Realtime updates must never change the version being reviewed.
  useEffect(() => { if (versions.ready && latest && !sel) setSel(latest.id); }, [versions.ready, latest?.id, sel]);
  const v = vs.find(x => x.id === selectedId);
  const urls = useSigned(v ? [v.file_path, v.poster_path] : []);
  const audioUrls = useSigned(comments.rows.map(c => c.audio_path));
  const jobs = useRows<any>('revision_jobs', { filter: ['asset_id', id], order: 'created_at' });
  const procs = useRows<Processing>('processing', { filter: ['asset_id', id], order: 'created_at', asc: true });
  const hfJobs = useRows<any>('higgsfield_jobs', { filter: ['asset_id', id], order: 'created_at' });
  const hfLive = hfJobs.rows.find((j: any) => j.status === 'submitted');
  useHiggsfieldPoll(hfLive?.id || null, () => { hfJobs.reload(); versions.reload(); procs.reload(); comments.reload(); });
  const playhead = () => { const pv = document.getElementById('pv') as HTMLVideoElement | null; return pv ? Math.round(pv.currentTime * 10) / 10 : null; };
  // Voice is the primary way to review: the live transcript fills the note box, the audio is kept with it.
  const cmtBase = useRef('');
  const cmtRec = useRecorder({ playheadSec: playhead, toast, onText: t => setCmt((cmtBase.current ? cmtBase.current + ' ' : '') + t) });
  const [busy, setBusy] = useState(false);
  const selectVersion = (versionId: string) => {
    setCmt(''); setAtHead(false); setShare(false);
    router.replace(assetVersionPath(id, versionId), { scroll: false });
  };
  if (!assets.ready || !versions.ready || (latest && selectedId === null)) return <div className="empty"><span className="muted">Loading</span></div>;
  if (!a || !v) return <div className="empty"><h2>{requested !== null ? 'Version not found' : 'Not found'}</h2><Link className="btn" href="/">Back to Library</Link></div>;
  const rev = reviews.rows.find(r => r.version_id === v.id); const isLatest = v.id === latest?.id;
  const blockedApproval = approvalBlock(v);
  const src = v.source || {};
  const manage = canManage(member, a); const ownerName = who(a.owner_id, a.legacy_creator);
  const canComment = can(member, 'creator') || can(member, 'approver');
  const proc = procs.rows[procs.rows.length - 1] || null;
  const active = activeProcessing(proc);
  const inFlight = new Set(active?.comment_ids || []);
  const activeNext = active ? (vs.find(x => x.id === active.reviewed_version_id)?.version || 0) + 1 : (latest?.version || 0) + 1;

  const review = async (status: 'approved') => {
    if (blockedApproval) { toast(blockedApproval); return; }
    setBusy(true);
    const { error } = await sb().from('reviews').upsert({ version_id: v.id, status, note: null }, { onConflict: 'version_id' });
    toast(error ? 'Not saved · ' + error.message : `v${v.version} approved`);
    setBusy(false);
  };
  // Reject: not worth fixing. The ad leaves the Library (archived, restorable) and queued revisions are cancelled.
  const reject = async () => {
    if (cmtRec.state === 'rec') cmtRec.stop();
    setBusy(true);
    const { error } = await sb().from('assets').update({ archived: true, archived_note: `Rejected by ${member?.display_name || 'a reviewer'}` }).eq('id', a.id);
    setBusy(false);
    if (error) { toast('Not saved · ' + error.message); return; }
    toast(`Rejected · ${a.concept_name} left the Library`); router.push('/');
  };
  const restore = async () => { const { error } = await sb().from('assets').update({ archived: false }).eq('id', a.id); toast(error ? error.message : 'Restored to the Library'); assets.reload(); };
  // Legacy worker jobs (no run) show only while they still need attention; finished ones belong to history.
  const job = [...jobs.rows].reverse().find((j: any) => j.version_id === v.id && !j.processing_id && ['queued', 'working', 'needs_input', 'failed'].includes(j.state)) || null;
  const revert = async () => {
    if (!latest) return; setBusy(true);
    const { data, error } = await sb().rpc('revert_asset', { p_asset: a.id, p_from_version: v.id, p_expected_latest: latest.id });
    setBusy(false);
    if (error) { toast(/stale_parent/.test(error.message) ? 'A newer version was just saved. Reload and try again.' : 'Not reverted · ' + error.message); versions.reload(); return; }
    toast(`Reverted · v${(data as any).version} is a copy of v${v.version}`); versions.reload(); selectVersion((data as any).id);
  };
  const download = async () => {
    if (!v.file_path) return;
    const ext = v.file_path.split('.').pop();
    const { data } = await sb().storage.from('ad-assets').createSignedUrl(v.file_path, 600, { download: `${a.concept_name.replace(/[^\w -]/g, '').slice(0, 60)}-v${v.version}.${ext}` });
    if (data?.signedUrl) location.href = data.signedUrl;
  };
  const closeMenu = (e: React.MouseEvent) => { const d = (e.currentTarget as HTMLElement).closest('details'); if (d) d.open = false; };
  const hasMore = !!src.link || (manage && a.archived);
  const copyRows = [...(v.copy?.headlines || []).map((t: string) => ['Headline', t]), ...(v.copy?.primaryText || []).map((t: string) => ['Primary text', t])];

  return <>
    <div className="asset">
      <div className="stage">
        <div className="stagebar">
          {/* Only the version in view; other versions are opened from Previous runs and versions. */}
          <span className="muted small" id="viewing">Viewing v{v.version}{vs.length > 1 ? (isLatest ? ' · latest' : ` · older, latest is v${latest?.version}`) : ''}</span>
        </div>
        {!isLatest && latest ? <div className="banner" role="status"><span>You’re viewing v{v.version}. A newer version is available.</span>
          <span className="row"><button className="btn small" onClick={() => selectVersion(latest.id)}>View v{latest.version}</button>
            {manage ? <button className="btn small" disabled={busy} onClick={revert}>Revert to v{v.version}</button> : null}</span></div> : null}
        <div className="preview"><Player v={v} urls={urls} /></div>
      </div>

      <div className="side">
        <div className="titleblock">
          <Link href="/" className="back">← Library</Link>
          <h1>{a.concept_name.trim()}</h1>
          <div className="meta">{ownerName} · {KIND_LABEL[a.kind]} · {frameLabel(v, a.format)}{v.duration_sec ? ' · ' + fmtSec(v.duration_sec) : ''}</div>
          <div className="statusline">{renderChip(v) || statusChip(rev?.status || 'pending')}
            {a.archived ? <span className="chip plain">Archived</span> : null}
            <span className="muted small">{rev ? `${rev.status === 'approved' ? 'Approved' : 'Changes requested'} by ${who(rev.reviewer)} · ${fmtDate(rev.at)}` : `v${v.version} by ${who(v.created_by, v.legacy_creator)} · ${fmtDate(v.created_at)}`}</span></div>
        </div>

        {/* Row 1 decides: process feedback into the next version, approve or reject the ad. Row 2 moves it. */}
        <div className="actions" role="group" aria-label="Decide">
          {manage ? <ProcessFeedback a={a} vs={vs} comments={comments.rows} proc={proc} reload={() => { procs.reload(); comments.reload(); versions.reload(); }} toast={toast} me={member?.user_id} who={who} /> : null}
          {can(member, 'approver') ? <button className="btn" disabled={busy || !!blockedApproval || rev?.status === 'approved'} title={blockedApproval || 'Final approval: this version is ready to run'} onClick={() => review('approved')}>{rev?.status === 'approved' ? `v${v.version} approved` : `Approve v${v.version}`}</button> : null}
          {manage && !a.archived ? <button className="btn quiet-danger" disabled={busy} title="Moves it to Rejected and archived. You can restore it later." onClick={reject}>Reject ad</button> : null}
        </div>
        <div className="actions" role="group" aria-label="Share and download">
          <button className="btn" onClick={() => setShare(true)}>Share</button>
          {v.file_path ? <button className="btn" onClick={download}>Download</button> : null}
          {hasMore ? <details className="dd"><summary className="btn ghost icon" aria-label="More actions" title="More actions">•••</summary>
            <div className="menu" role="menu">
              {src.link ? <a role="menuitem" className="mi" href={src.link} target="_blank" rel="noopener" onClick={closeMenu}>Open editable source</a> : null}
              {manage && a.archived ? <button role="menuitem" type="button" className="mi" onClick={e => { closeMenu(e); void restore(); }}>Restore to Library</button> : null}
            </div></details> : null}
        </div>

        {v.render?.note && v.file_path ? <div className="muted">{v.render.note}</div> : null}
        {job ? <JobStatus job={job} vs={vs} onOpen={selectVersion} /> : null}

        <section className="section" aria-labelledby="gfH">
          {canComment ? <form className="composer-box" aria-label="Add feedback" onSubmit={async e => { e.preventDefault(); const t = cmt.trim(); if (!t && !cmtRec.take) return;
              if (cmtRec.state === 'rec') { toast('Stop the recording first'); return; }
              try {
                if (cmtRec.take) await saveVoiceComment(a.id, v.id, cmtRec.take, t);
                else { const pv = document.getElementById('pv') as HTMLVideoElement | null;
                  const { error } = await sb().from('comments').insert({ asset_id: a.id, version_id: v.id, body: t, at_sec: isVideo(v) && atHead && pv ? Math.round(pv.currentTime * 10) / 10 : null }); if (error) throw error; }
                setCmt(''); cmtBase.current = ''; cmtRec.clear(); comments.reload();
                toast(manage ? 'Feedback added · include it below' : `Feedback sent to ${ownerName}`);
              } catch (err: any) { toast('Not saved · ' + (err?.message || err)); } }}>
            <div className="sechead"><h2 id="gfH"><label htmlFor="cmt">Give feedback</label></h2><span className="muted small">on v{v.version}{isLatest ? ' (latest)' : ` · older version, latest is v${latest?.version}`}</span></div>
            <textarea id="cmt" rows={3} placeholder="Talk or type what should change" value={cmt} onChange={e => setCmt(e.target.value)} />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="row"><RecordControl r={{ ...cmtRec, start: () => { cmtBase.current = cmt.trim(); return cmtRec.start(); } }} label="Record" />
                {isVideo(v) ? <label className="row small"><input type="checkbox" checked={atHead} onChange={e => setAtHead(e.target.checked)} /> At playhead</label> : null}</span>
              <button className="btn primary" disabled={cmtRec.state === 'rec' || !(cmt.trim() || cmtRec.take)}>Add feedback</button></div>
          </form> : <p className="hint">View-only access. Ask Shane for Creator to leave feedback.</p>}
        </section>

        <FeedbackThread comments={comments.rows} vs={vs} manage={manage} inFlight={inFlight} nextVersion={activeNext} latestVersion={latest?.version || 0} who={who} audioUrls={audioUrls} toast={toast}
          reload={() => { comments.reload(); procs.reload(); }} />

        <PreviousRuns viewedVersionId={v.id} comments={comments.rows} runs={procs.rows as any} shares={shares.rows} onOpen={selectVersion} vs={vs} manage={manage} who={who} audioUrls={audioUrls} toast={toast} reload={() => { comments.reload(); procs.reload(); }} />

        <div>
          {copyRows.length || v.copy?.cta ? <details className="disc"><summary>Copy</summary><div className="inner">
            <div className="tbl"><table><tbody>
              {copyRows.map(([k, t]: string[], i: number) => <tr key={i}><th>{k}</th><td>{t}</td></tr>)}
              <tr><th>CTA</th><td>{v.copy?.cta || '--'}</td></tr><tr><th>Destination</th><td>{v.copy?.destination || 'Not set'}</td></tr></tbody></table></div></div></details> : null}
          {(v.qa || []).length ? <details className="disc"><summary>Checks<span className="muted">{v.qa.filter((q: any) => q.status !== 'pass').length ? `${v.qa.filter((q: any) => q.status !== 'pass').length} to look at` : 'All passed'}</span></summary><div className="inner">
            <div className="qa">{v.qa.map((q: any, i: number) => <div key={i}><span className={'chip ' + (q.status === 'pass' ? 'ok' : q.status === 'warn' ? 'warn' : 'err')}>{q.status === 'pass' ? 'Pass' : q.status === 'warn' ? 'Warn' : 'Fail'}</span><b>{q.check}</b><span className="muted">{q.note}</span></div>)}</div></div></details> : null}
          <details className="disc"><summary>File and source</summary><div className="inner">
            <dl className="kv"><dt>Version</dt><dd>v{v.version}{v.parent_version_id ? ' from v' + (vs.find(x => x.id === v.parent_version_id)?.version ?? '?') : ''}</dd>
              <dt>Made with</dt><dd>{src.tool || '--'}{src.model ? ' · ' + src.model : ''}</dd><dt>Prompt</dt><dd>{src.prompt || '--'}</dd>
              <dt>File</dt><dd>{v.width && v.height ? `${v.width}×${v.height} · ` : ''}{v.duration_sec ? fmtSec(v.duration_sec) + ' · ' : ''}{fmtBytes(v.size_bytes)} · {v.content_type || '--'}</dd>
              <dt>Source</dt><dd>{src.link ? <a href={src.link} target="_blank" rel="noopener">Open editable source</a> : 'Not attached'}</dd>
              <dt>SHA-256</dt><dd className="mono">{(v.sha256 || '').slice(0, 16)}…</dd><dt>ID</dt><dd className="mono">{v.id}</dd></dl></div></details>
        </div>
      </div>
    </div>
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
    <span className={'chip ' + (job.state === 'done' ? 'ok' : job.state === 'failed' || job.state === 'needs_input' ? 'warn' : job.state === 'cancelled' ? 'plain' : 'live')}>{JOB_TEXT[job.state] || job.state}</span>
    {job.state === 'working' && job.claimed_at ? <span className="muted small">since {fmtDate(job.claimed_at)}</span> : null}
    {out ? <button className="btn small" onClick={() => onOpen(out.id)}>View v{out.version}</button> : null}
    {job.message ? <span className="muted small" style={{ flexBasis: '100%' }}>{job.message}</span> : null}
    {job.session_url && job.state !== 'done' ? <a className="muted small" href={job.session_url} target="_blank" rel="noopener">Open Claude session</a> : null}
  </div>;
}
