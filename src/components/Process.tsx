'use client';
import { useEffect, useRef, useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { fmtDate, type Asset, type Comment, type Version } from '@/lib/data';

export type Processing = {
  id: string; asset_id: string; reviewed_version_id: string; comment_ids: string[]; processor: string | null; started_by: string | null;
  started_via: 'app' | 'claude'; status: 'reviewing' | 'approved' | 'executing' | 'done' | 'failed' | 'cancelled';
  proposal: any; decisions: Decision[]; instructions: string | null; result_version_id: string | null; message: string | null; rev: number;
  history: { at: string; by: string; event: string }[]; created_at: string; updated_at: string;
  engine?: 'worker' | 'higgsfield' | 'claude'; claimed_by?: string | null; claimed_at?: string | null; feedback_snapshot?: { comment_id: string; body: string; author_name: string }[];
};
export type Decision = { comment_id: string; decision: 'apply' | 'defer' | 'dismiss'; note?: string };

const friendly = (e: any) => String(e?.message || e).replace(/^.*?: /, '');
export const activeProcessing = (p: Processing | null) => (p && ['approved', 'executing'].includes(p.status) ? p : null);

/** The scheduled worker can only rebuild versions made with a repo engine (creative/...). Anything else is made in a person's Claude. */
export const workerCanRebuild = (v?: Version | null) => typeof v?.source?.engine === 'string' && v.source.engine.startsWith('creative/');

/** Owner/admin only: the single "Process feedback" action in the top row. It sends every included (approved), open
 *  feedback item (the server collects them when pressed) into the next version, routed by how the ad was made:
 *  the scheduled worker, a paid Higgsfield render (confirmed first), or a manual hand-off to the owner's Claude.
 *  Confirmation and hand-off open on demand; while a run is active there is only a compact status line. */
export default function ProcessFeedback({ a, vs, comments, proc, reload, toast, me, who }: {
  a: Asset; vs: Version[]; comments: Comment[]; proc: Processing | null; reload: () => void;
  toast: (m: string) => void; onOpen?: (versionId: string) => void; me?: string | null; who?: (id?: string | null) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<null | 'higgsfield' | 'claude'>(null);
  const [used, setUsed] = useState<{ seconds_this_month: number; monthly_cap_seconds: number | null } | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const active = activeProcessing(proc);
  const included = comments.filter(c => c.status === 'open' && !c.deleted_at && c.decision === 'approved' && !active?.comment_ids.includes(c.id));
  const latest = vs[vs.length - 1];
  const nextV = (latest?.version || 0) + 1;
  const activeNext = active ? (vs.find(v => v.id === active.reviewed_version_id)?.version || 0) + 1 : nextV;
  const parent = [...vs].reverse().find(v => v.file_path);
  const hfSpec = parent?.spec?.type === 'higgsfield' && parent.render?.state !== 'failed' ? parent.spec : null;
  const viaClaude = !hfSpec && !workerCanRebuild(parent);
  const prompt = `Make the next version of “${a.concept_name.trim()}” in Ad Studio with its approved feedback (ad ${a.id}).`;
  const failed = !active && proc?.status === 'failed' ? proc : null;

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    const out = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('keydown', esc); document.addEventListener('mousedown', out);
    return () => { document.removeEventListener('keydown', esc); document.removeEventListener('mousedown', out); };
  }, [open]);

  const press = async () => {
    if (hfSpec) {
      setOpen('higgsfield');
      try { const r = await fetch('/api/higgsfield/usage'); if (r.ok) setUsed(await r.json()); } catch { /* usage is informative only */ }
      return;
    }
    if (viaClaude) { setOpen('claude'); return; }
    setBusy(true);
    const { error } = await sb().rpc('feedback_process', { p_asset: a.id, p_note: null });
    toast(error ? friendly(error) : `Queued · Claude picks up v${nextV} within the hour`);
    setBusy(false); reload();
  };
  const renderHiggsfield = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/higgsfield/revise', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asset_id: a.id, note: null, confirm: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) toast(j.message || 'Not started'); else { toast(j.repeated ? 'Already rendering' : `Rendering v${nextV} in Higgsfield`); setOpen(null); }
    } catch { toast('No answer. It may have started: check before trying again.'); }
    setBusy(false); reload();
  };
  const copy = async () => { try { await navigator.clipboard.writeText(prompt); toast('Copied · paste it into Claude'); setOpen(null); } catch { toast('Select the text and copy it'); } };
  const cancel = async (message: string) => {
    if (!active) return; setBusy(true);
    const { error } = await sb().rpc('processing_set_status', { p_id: active.id, p_rev: active.rev, p_status: 'cancelled', p_message: message });
    toast(error ? friendly(error) : 'Cancelled · feedback stays included'); setBusy(false); reload();
  };

  const n = active ? active.comment_ids.length : 0;
  const items = `${n} item${n === 1 ? '' : 's'} marked below`;
  let status: React.ReactNode = null;
  if (active?.engine === 'claude') {
    const mine = !!me && active.claimed_by === me;
    status = <><span className="chip live"><span className="dot" />{mine ? `You’re making v${activeNext} in Claude` : `${who ? who(active.claimed_by) : 'Someone'} is making v${activeNext} in Claude`}</span>
      <span className="muted small">{items}{active.claimed_at ? ` · since ${fmtDate(active.claimed_at)}` : ''}</span>
      {mine ? <button type="button" className="linkish" disabled={busy} onClick={() => cancel('Cancelled in the app')}>Cancel</button> : null}</>;
  } else if (active?.engine === 'higgsfield') {
    status = <><span className="chip live"><span className="dot" />Rendering v{activeNext} in Higgsfield</span><span className="muted small">{items}{active.message ? ` · ${active.message}` : ''}</span></>;
  } else if (active) {
    status = <><span className="chip live"><span className="dot" />{active.status === 'executing' ? `Claude is making v${activeNext}` : `Queued for v${activeNext}`}</span>
      <span className="muted small">{items} · {active.status === 'executing' ? `started ${fmtDate(active.updated_at)}` : 'Claude starts within the hour'}</span>
      {active.status === 'approved' ? <button type="button" className="linkish" disabled={busy} onClick={() => cancel('Cancelled before Claude started')}>Cancel</button> : null}</>;
  }

  const why = active ? 'A version is already being made' : !included.length ? 'Include feedback below to process it' : `Make v${nextV} from ${included.length} included item${included.length === 1 ? '' : 's'}`;
  return <>
    <span className="proc" ref={wrap}>
      <button type="button" className="btn primary" id="process-feedback" disabled={busy || !!active || !included.length} title={why}
        aria-haspopup={hfSpec || viaClaude ? 'dialog' : undefined} aria-expanded={hfSpec || viaClaude ? !!open : undefined} onClick={press}>Process feedback</button>
      {open === 'higgsfield' && hfSpec ? <div className="pop" role="alertdialog" aria-label="Confirm paid render">
        <b>Paid Higgsfield render of v{nextV}</b>
        <span className="muted small">{included.length} included item{included.length === 1 ? '' : 's'} · {hfSpec.duration}s · {hfSpec.aspect_ratio} · {hfSpec.audio ? 'with sound' : 'no sound'}{used ? ` · ${used.seconds_this_month}s used this month${used.monthly_cap_seconds ? ` of ${used.monthly_cap_seconds}` : ''}` : ''}</span>
        <span className="row"><button type="button" className="btn small" disabled={busy} onClick={() => setOpen(null)}>Not now</button><button type="button" className="btn small primary" disabled={busy} onClick={renderHiggsfield}>Render v{nextV}</button></span>
      </div> : null}
      {open === 'claude' ? <div className="pop" role="dialog" aria-label="Process in Claude">
        <b>Made in {String(parent?.source?.tool || 'Claude')}: process it in Claude</b>
        <span className="muted small">The hourly worker can’t rebuild this ad. Paste this into Claude with the Ad Studio connector. It claims the run, sees only the {included.length} included item{included.length === 1 ? '' : 's'}, and saves v{nextV} here.</span>
        <span className="mono small">{prompt}</span>
        <span className="row"><button type="button" className="btn small" onClick={() => setOpen(null)}>Close</button><button type="button" className="btn small primary" onClick={copy}>Copy request</button></span>
      </div> : null}
    </span>
    {status ? <span className="procnote" role="status">{status}</span>
      : failed ? <span className="procnote err" role="alert"><b>Last run failed.</b> Nothing was applied; the feedback is still open{failed.message ? ` · ${failed.message}` : ''}. Process feedback again to retry.</span> : null}
  </>;
}
