'use client';
import { useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { fmtDate, fmtSec, type Asset, type Comment, type Version } from '@/lib/data';

export type Processing = {
  id: string; asset_id: string; reviewed_version_id: string; comment_ids: string[]; processor: string | null; started_by: string | null;
  started_via: 'app' | 'claude'; status: 'reviewing' | 'approved' | 'executing' | 'done' | 'failed' | 'cancelled';
  proposal: any; decisions: Decision[]; instructions: string | null; result_version_id: string | null; message: string | null; rev: number;
  history: { at: string; by: string; event: string }[]; created_at: string; updated_at: string;
};
export type Decision = { comment_id: string; decision: 'apply' | 'defer' | 'dismiss'; note?: string };

const friendly = (e: any) => String(e?.message || e).replace(/^.*?: /, '');

/** Owner view. Feedback is one list: approve or reject each item (saved right away), then Process sends every
 *  approved item into the next version. Undecided items wait. */
export default function ProcessFeedback({ a, vs, comments, proc, reload, who, audioUrls, toast, onOpen }: {
  a: Asset; vs: Version[]; comments: Comment[]; proc: Processing | null; reload: () => void; who: (id?: string | null, legacy?: string | null) => string;
  audioUrls: Record<string, string>; toast: (m: string) => void; onOpen: (versionId: string) => void; ownerName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const active = proc && ['approved', 'executing'].includes(proc.status) ? proc : null;
  const inFlight = new Set(active?.comment_ids || []);
  const open = comments.filter(c => c.status === 'open' && !c.deleted_at);
  const waiting = open.filter(c => !inFlight.has(c.id));
  const approved = waiting.filter(c => c.decision === 'approved');
  const latest = vs[vs.length - 1];
  const nextV = (latest?.version || 0) + 1;

  const decide = async (c: Comment, d: 'approved' | 'rejected' | 'undecided') => {
    setBusy(true);
    const { error } = await sb().rpc('feedback_decide', { p_comment: c.id, p_decision: d });
    if (error) toast(friendly(error));
    setBusy(false); reload();
  };
  const process = async () => {
    setBusy(true);
    const { error } = await sb().rpc('feedback_process', { p_asset: a.id, p_note: note.trim() || null });
    if (error) toast(friendly(error));
    else { toast(`Processing ${approved.length} approved item${approved.length === 1 ? '' : 's'} · v${nextV} lands in the Library within the hour`); setNote(''); }
    setBusy(false); reload();
  };

  const last = proc && ['done', 'failed'].includes(proc.status) ? proc : null;
  const lastOut = last?.result_version_id ? vs.find(v => v.id === last.result_version_id) : null;

  return <section className="panel" aria-label="Feedback on your ad">
    <div className="row" style={{ justifyContent: 'space-between' }}><h3>Feedback to decide · {waiting.length}</h3></div>
    {active ? <div className="row" role="status"><span className="chip live">{active.status === 'executing' ? `Claude is making v${(vs.find(v => v.id === active.reviewed_version_id)?.version || 0) + 1}` : `Queued · v${(vs.find(v => v.id === active.reviewed_version_id)?.version || 0) + 1} arrives within the hour`}</span>
      <span className="muted">{active.comment_ids.length} approved item{active.comment_ids.length === 1 ? '' : 's'}{active.instructions ? ' + your note' : ''}</span>
      {active.status === 'approved' ? <button className="btn small quiet-danger" disabled={busy} onClick={async () => {
        setBusy(true); const { error } = await sb().rpc('processing_set_status', { p_id: active.id, p_rev: active.rev, p_status: 'cancelled', p_message: 'Cancelled before Claude started' });
        toast(error ? friendly(error) : 'Cancelled · feedback stays approved'); setBusy(false); reload(); }}>Cancel</button> : null}</div> : null}
    {last && !active ? <div className="row" role="status"><span className={'chip ' + (last.status === 'done' ? 'ok' : 'warn')}>{last.status === 'done' ? `v${lastOut?.version ?? ''} ready` : 'Last revision failed'}</span>
      {lastOut ? <button className="btn small" onClick={() => onOpen(lastOut.id)}>View v{lastOut.version}</button> : null}
      {last.status === 'failed' && last.message ? <span className="muted">{last.message}</span> : null}</div> : null}
    {!waiting.length ? <p className="muted">{active ? 'New feedback will show up here for the version after.' : 'No feedback waiting.'}</p> : <>
      <p className="muted">Approve what should change, reject the rest. Process sends every approved item into v{active ? nextV + 1 : nextV}.</p>
      {waiting.map(c => { const cv = vs.find(x => x.id === c.version_id); const d = c.decision === 'approved' ? 'apply' : '';
        return <div key={c.id} className={'cmt decide' + (d ? ' ' + d : '')}>
          <div className="row"><b>{who(c.author, c.legacy_author)}</b><span className="muted">v{cv?.version ?? '?'}{c.at_sec != null ? ' · at ' + fmtSec(c.at_sec) : ''} · {fmtDate(c.created_at)}{c.source === 'slack' ? ' · Slack' : ''}</span></div>
          {c.audio_path ? <audio controls preload="none" src={audioUrls[c.audio_path]} style={{ width: '100%' }} aria-label="Voice note" /> : null}
          {c.audio_path && c.body === 'Voice note' ? <span className="muted">No transcript</span> : <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>}
          <div className="seg" role="radiogroup" aria-label="Use this feedback?">
            <button type="button" role="radio" aria-checked={c.decision === 'approved'} disabled={busy} onClick={() => decide(c, c.decision === 'approved' ? 'undecided' : 'approved')}>Approve</button>
            <button type="button" role="radio" aria-checked={false} disabled={busy} onClick={() => decide(c, 'rejected')}>Reject</button>
          </div>
        </div>; })}
    </>}
    {!active ? <>
      <label htmlFor="proc-instr" className="muted">Anything else to change (optional)</label>
      <textarea id="proc-instr" rows={2} placeholder="e.g. keep Henry’s visual, use Teng’s headline" value={note} onChange={e => setNote(e.target.value)} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted" role="status">{approved.length} approved · {waiting.length - approved.length} not decided</span>
        <button className="btn primary" disabled={busy || (!approved.length && !note.trim())} onClick={process}>Process approved feedback</button>
      </div></> : null}
  </section>;
}
