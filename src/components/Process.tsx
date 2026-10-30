'use client';
import { useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { fmtDate, type Asset, type Comment, type Version } from '@/lib/data';

export type Processing = {
  id: string; asset_id: string; reviewed_version_id: string; comment_ids: string[]; processor: string | null; started_by: string | null;
  started_via: 'app' | 'claude'; status: 'reviewing' | 'approved' | 'executing' | 'done' | 'failed' | 'cancelled';
  proposal: any; decisions: Decision[]; instructions: string | null; result_version_id: string | null; message: string | null; rev: number;
  history: { at: string; by: string; event: string }[]; created_at: string; updated_at: string;
  engine?: 'worker' | 'higgsfield'; feedback_snapshot?: { comment_id: string; body: string; author_name: string }[];
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
  const [note, setNote] = useState(''); const [confirm, setConfirm] = useState(false);
  const [used, setUsed] = useState<{ seconds_this_month: number; monthly_cap_seconds: number | null } | null>(null);
  const active = activeProcessing(proc);
  const inFlight = new Set(active?.comment_ids || []);
  const approved = comments.filter(c => c.status === 'open' && !c.deleted_at && !inFlight.has(c.id) && c.decision === 'approved');
  const latest = vs[vs.length - 1];
  const nextV = (latest?.version || 0) + 1;
  const activeNext = active ? (vs.find(v => v.id === active.reviewed_version_id)?.version || 0) + 1 : nextV;
  // A finished Higgsfield video regenerates in Higgsfield (paid, confirmed here); everything else goes to the worker.
  const parent = [...vs].reverse().find(v => v.file_path);
  const hfSpec = parent?.spec?.type === 'higgsfield' && parent.render?.state !== 'failed' ? parent.spec : null;
  const last = proc && ['done', 'failed'].includes(proc.status) ? proc : null;
  const lastOut = last?.result_version_id ? vs.find(v => v.id === last.result_version_id) : null;

  const regenerate = async () => {
    setBusy(true);
    const { error } = await sb().rpc('feedback_process', { p_asset: a.id, p_note: note.trim() || null });
    if (error) toast(friendly(error));
    else { toast(`Queued · Claude picks up v${nextV} within the hour`); setNote(''); }
    setBusy(false); reload();
  };
  const askHiggsfield = async () => {
    setConfirm(true);
    try { const r = await fetch('/api/higgsfield/usage'); if (r.ok) setUsed(await r.json()); } catch { /* usage is informative only */ }
  };
  const regenerateHiggsfield = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/higgsfield/revise', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asset_id: a.id, note: note.trim() || null, confirm: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) toast(j.message || 'Not started'); else { toast(j.repeated ? 'Already rendering' : `Rendering v${nextV} in Higgsfield`); setNote(''); setConfirm(false); }
    } catch { toast('No answer. It may have started: check before trying again.'); }
    setBusy(false); reload();
  };
  const cancel = async () => {
    if (!active) return; setBusy(true);
    const { error } = await sb().rpc('processing_set_status', { p_id: active.id, p_rev: active.rev, p_status: 'cancelled', p_message: 'Cancelled before Claude started' });
    toast(error ? friendly(error) : 'Cancelled · feedback stays approved'); setBusy(false); reload();
  };

  if (active && active.engine === 'higgsfield') return <section id="process-panel" className="regen" aria-label="Next version">
    <div className="top" role="status"><div className="row">
      <span className="chip live"><span className="dot" />Rendering v{activeNext} in Higgsfield</span>
      <span className="muted small">Usually a few minutes. Saved here when ready.</span></div></div>
    <span className="muted small">{active.comment_ids.length} approved change{active.comment_ids.length === 1 ? '' : 's'} frozen when you pressed Regenerate{active.instructions ? ' + your note' : ''}. New feedback goes into the version after.</span>
    {active.message ? <div className="banner" role="alert">{active.message}</div> : null}
  </section>;

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
      {hfSpec ? <button className="btn primary" disabled={busy || confirm || (!approved.length && !note.trim())} onClick={askHiggsfield}>Regenerate in Higgsfield</button>
        : <button className="btn primary" disabled={busy || (!approved.length && !note.trim())} onClick={regenerate}>Regenerate ad</button>}
    </div>
    {hfSpec && confirm ? <div className="banner" role="alertdialog" aria-label="Confirm paid render">
      <span>Paid render: {hfSpec.duration}s · {hfSpec.aspect_ratio} · {hfSpec.audio ? 'with sound' : 'no sound'}{used ? ` · ${used.seconds_this_month}s used this month${used.monthly_cap_seconds ? ` of ${used.monthly_cap_seconds}` : ''}` : ''}</span>
      <span className="row"><button className="btn small" disabled={busy} onClick={() => setConfirm(false)}>Not now</button><button className="btn small primary" disabled={busy} onClick={regenerateHiggsfield}>Render v{nextV}</button></span>
    </div> : null}
    <details>
      <summary>Add a note for Claude</summary>
      <label htmlFor="proc-instr" className="sr">Note for Claude (optional)</label>
      <textarea id="proc-instr" rows={2} style={{ marginTop: 8 }} placeholder="e.g. keep Henry’s visual, use Teng’s headline" value={note} onChange={e => setNote(e.target.value)} />
    </details>
  </section>;
}
