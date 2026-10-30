'use client';
import { useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { fmtDate, type Asset, type Comment, type Version } from '@/lib/data';

export type Processing = {
  id: string; asset_id: string; reviewed_version_id: string; comment_ids: string[]; processor: string | null; started_by: string | null;
  started_via: 'app' | 'claude'; status: 'reviewing' | 'approved' | 'executing' | 'done' | 'failed' | 'cancelled';
  proposal: any; decisions: Decision[]; instructions: string | null; result_version_id: string | null; message: string | null; rev: number;
  history: { at: string; by: string; event: string }[]; created_at: string; updated_at: string;
};
export type Decision = { comment_id: string; decision: 'apply' | 'defer' | 'dismiss'; note?: string };

const friendly = (e: any) => String(e?.message || e).replace(/^.*?: /, '');
export const activeProcessing = (p: Processing | null) => (p && ['approved', 'executing'].includes(p.status) ? p : null);

/** Owner/admin only. One primary action: Regenerate ad sends every approved, open feedback item (the server collects
 *  them at the moment of pressing) into the next version. The revision worker runs on a schedule, so a queued
 *  request says so instead of promising an instant result. */
export default function ProcessFeedback({ a, vs, comments, proc, reload, toast, onOpen }: {
  a: Asset; vs: Version[]; comments: Comment[]; proc: Processing | null; reload: () => void;
  toast: (m: string) => void; onOpen: (versionId: string) => void; who?: unknown; audioUrls?: unknown; ownerName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const active = activeProcessing(proc);
  const inFlight = new Set(active?.comment_ids || []);
  const approved = comments.filter(c => c.status === 'open' && !c.deleted_at && !inFlight.has(c.id) && c.decision === 'approved');
  const latest = vs[vs.length - 1];
  const nextV = (latest?.version || 0) + 1;
  const activeNext = active ? (vs.find(v => v.id === active.reviewed_version_id)?.version || 0) + 1 : nextV;
  const last = proc && ['done', 'failed'].includes(proc.status) ? proc : null;
  const lastOut = last?.result_version_id ? vs.find(v => v.id === last.result_version_id) : null;

  const regenerate = async () => {
    setBusy(true);
    const { error } = await sb().rpc('feedback_process', { p_asset: a.id, p_note: note.trim() || null });
    if (error) toast(friendly(error));
    else { toast(`Queued · Claude picks up v${nextV} within the hour`); setNote(''); }
    setBusy(false); reload();
  };
  const cancel = async () => {
    if (!active) return; setBusy(true);
    const { error } = await sb().rpc('processing_set_status', { p_id: active.id, p_rev: active.rev, p_status: 'cancelled', p_message: 'Cancelled before Claude started' });
    toast(error ? friendly(error) : 'Cancelled · feedback stays approved'); setBusy(false); reload();
  };

  if (active) return <section id="process-panel" className="regen" aria-label="Next version">
    <div className="top" role="status">
      <div className="row">
        <span className="chip live"><span className="dot" />{active.status === 'executing' ? `Claude is making v${activeNext}` : `Queued for v${activeNext}`}</span>
        <span className="muted small">{active.status === 'executing' ? `Started ${fmtDate(active.updated_at)}` : 'Claude starts within the hour'}</span>
      </div>
      {active.status === 'approved' ? <button className="btn small ghost" disabled={busy} onClick={cancel}>Cancel</button> : null}
    </div>
    <span className="muted small">{active.comment_ids.length} approved change{active.comment_ids.length === 1 ? '' : 's'}{active.instructions ? ' + your note' : ''}. New feedback goes into the version after.</span>
  </section>;

  return <section id="process-panel" className="regen" aria-label="Next version">
    {last ? <div className="row" role="status">
      <span className={'chip ' + (last.status === 'done' ? 'ok' : 'err')}>{last.status === 'done' ? `v${lastOut?.version ?? ''} ready` : 'Last regenerate failed'}</span>
      {lastOut ? <button className="btn small ghost" onClick={() => onOpen(lastOut.id)}>View v{lastOut.version}</button> : null}
      {last.status === 'failed' && last.message ? <span className="muted small" style={{ flexBasis: '100%' }}>{last.message}</span> : null}
    </div> : null}
    <div className="top">
      <span role="status">{approved.length ? <><b>{approved.length} approved change{approved.length === 1 ? '' : 's'}</b><span className="muted"> → v{nextV}</span></> : <span className="muted">Approve feedback to make v{nextV}</span>}</span>
      <button className="btn primary" disabled={busy || (!approved.length && !note.trim())} onClick={regenerate}>Regenerate ad</button>
    </div>
    <details>
      <summary>Add a note for Claude</summary>
      <label htmlFor="proc-instr" className="sr">Note for Claude (optional)</label>
      <textarea id="proc-instr" rows={2} style={{ marginTop: 8 }} placeholder="e.g. keep Henry’s visual, use Teng’s headline" value={note} onChange={e => setNote(e.target.value)} />
    </details>
  </section>;
}
