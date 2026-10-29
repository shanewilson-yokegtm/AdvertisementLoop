'use client';
import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { fmtDate, fmtSec, type Asset, type Comment, type Version } from '@/lib/data';

export type Processing = {
  id: string; asset_id: string; reviewed_version_id: string; comment_ids: string[]; processor: string | null; started_by: string | null;
  started_via: 'app' | 'claude'; status: 'reviewing' | 'approved' | 'executing' | 'done' | 'failed' | 'cancelled';
  proposal: { summary?: string; items?: { comment_ids?: string[]; kind?: 'compatible' | 'conflict'; change?: string }[]; draft?: { decisions?: Decision[]; instructions?: string } };
  decisions: Decision[]; instructions: string | null; result_version_id: string | null; message: string | null; rev: number;
  history: { at: string; by: string; event: string }[]; created_at: string; updated_at: string;
};
export type Decision = { comment_id: string; decision: 'apply' | 'defer' | 'dismiss'; note?: string };

const STATUS: Record<string, string> = {
  reviewing: 'Reviewing feedback', approved: 'Changes approved · Claude makes the next version within the hour',
  executing: 'Claude is making the next version', done: 'Changes ready', failed: 'Revision failed', cancelled: 'Review cancelled',
};
const friendly = (e: any) => {
  const m = String(e?.message || e);
  if (/conflict/i.test(m)) return 'Someone else changed this review or the ad. Reloaded the latest.';
  return m.replace(/^.*?: /, '');
};

/** Process feedback: one shared review record (same one Claude uses). Opening it changes nothing; Execute changes runs only what's selected. */
export default function ProcessFeedback({ a, vs, comments, proc, reload, who, audioUrls, toast, onOpen, ownerName }: {
  a: Asset; vs: Version[]; comments: Comment[]; proc: Processing | null; reload: () => void; who: (id?: string | null, legacy?: string | null) => string;
  audioUrls: Record<string, string>; toast: (m: string) => void; onOpen: (versionId: string) => void; ownerName: string;
}) {
  const open = comments.filter(c => c.status === 'open');
  const [busy, setBusy] = useState(false);
  const [dec, setDec] = useState<Record<string, Decision>>({});
  const [instructions, setInstructions] = useState('');
  const active = proc && ['reviewing', 'approved', 'executing'].includes(proc.status) ? proc : null;

  // Load any saved draft (from the app or from Claude) into the form.
  useEffect(() => {
    if (!active) { setDec({}); setInstructions(''); return; }
    const src = active.status === 'reviewing' ? (active.proposal?.draft?.decisions || []) : active.decisions;
    setDec(Object.fromEntries((src || []).map(d => [d.comment_id, d])));
    setInstructions((active.status === 'reviewing' ? active.proposal?.draft?.instructions : active.instructions) || '');
  }, [active?.id, active?.rev]); // eslint-disable-line

  const call = async (fn: string, args: Record<string, any>, ok: string) => {
    setBusy(true);
    const { error } = await sb().rpc(fn, args);
    setBusy(false); reload();
    if (error) { toast(friendly(error)); return false; }
    toast(ok); return true;
  };

  if (!active) {
    const last = proc && ['done', 'failed', 'cancelled'].includes(proc.status) ? proc : null;
    const out = last?.result_version_id ? vs.find(v => v.id === last.result_version_id) : null;
    return <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}><h3>Feedback to process · {open.length}</h3>
        <button className="btn primary" disabled={busy || !open.length} onClick={() => call('processing_start', { p_asset: a.id, p_via: 'app' }, 'Review started · nothing changes until you execute')}>Process feedback</button></div>
      {!open.length ? <p className="muted">No open feedback.</p> : <p className="muted">Opens a review of everything open. Nothing changes until you pick what to apply and press Execute changes.</p>}
      {last ? <div className="row" role="status"><span className={'chip ' + (last.status === 'done' ? 'ok' : 'warn')}>{STATUS[last.status]}</span>
        {out ? <button className="btn small" onClick={() => onOpen(out.id)}>View v{out.version}</button> : null}
        {last.message ? <span className="muted" style={{ flexBasis: '100%' }}>{last.message}</span> : null}</div> : null}
    </div>;
  }

  const reviewed = vs.find(v => v.id === active.reviewed_version_id); const latest = vs[vs.length - 1];
  const inReview = active.comment_ids.map(id => comments.find(c => c.id === id)).filter(Boolean) as Comment[];
  const late = open.filter(c => !active.comment_ids.includes(c.id));
  const items = active.proposal?.items || [];
  const decisions = Object.values(dec);
  const nApply = decisions.filter(d => d.decision === 'apply').length;
  const editable = active.status === 'reviewing';
  const set = (id: string, decision: Decision['decision'] | null) => setDec(d => { const n = { ...d }; if (decision) n[id] = { ...(n[id] || {}), comment_id: id, decision }; else delete n[id]; return n; });
  const draft = { ...active.proposal, draft: { decisions, instructions } };

  return <div className="panel" aria-label="Process feedback">
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <h3>Process feedback</h3>
      <span className={'chip ' + (active.status === 'reviewing' ? 'warn' : '')}>{STATUS[active.status]}</span>
    </div>
    <div className="muted">
      Reviewing v{reviewed?.version}{latest && latest.id !== reviewed?.id ? ` · latest is v${latest.version}` : ''} · owner {ownerName}
      {active.processor ? ` · processing: ${who(active.processor)}` : ''}{active.history.some(h => h.event === 'takeover') ? ' (taken over)' : ''}
      {' · '}started in {active.started_via === 'claude' ? 'Claude' : 'the app'} {fmtDate(active.created_at)}
    </div>

    {items.length ? <div className="proposal">
      <b>Proposal</b>{active.proposal.summary ? <span className="muted"> · {active.proposal.summary}</span> : null}
      {items.map((it, i) => <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
        <span className={'chip ' + (it.kind === 'conflict' ? 'warn' : 'ok')}>{it.kind === 'conflict' ? 'Needs a choice' : 'Compatible'}</span>
        <span>{it.change}</span></div>)}
    </div> : editable ? <p className="muted">No proposal yet. Ask your Claude to “process feedback on this ad” to draft one, or decide below.</p> : null}

    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {inReview.map(c => { const cv = vs.find(x => x.id === c.version_id); const d = dec[c.id];
        return <div key={c.id} className="cmt">
          <div className="row"><b>{who(c.author, c.legacy_author)}</b><span className="muted">on v{cv?.version ?? '?'}{c.at_sec != null ? ' · at ' + fmtSec(c.at_sec) : ''} · {fmtDate(c.created_at)}{c.source === 'slack' ? ' · Slack' : ''}</span>
            {c.status !== 'open' ? <span className="chip">{c.status === 'applied' ? 'Applied' : 'Dismissed'}</span> : null}</div>
          {c.audio_path ? <audio controls preload="none" src={audioUrls[c.audio_path]} style={{ width: '100%' }} aria-label="Voice note" /> : null}
          {c.audio_path && c.body === 'Voice note' ? <span className="muted">No transcript</span> : <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>}
          {c.status === 'open' ? <div className="seg" role="radiogroup" aria-label="Decision">
            {(['apply', 'defer', 'dismiss'] as const).map(k => <button key={k} type="button" role="radio" aria-checked={d?.decision === k} disabled={!editable}
              onClick={() => set(c.id, d?.decision === k ? null : k)}>{k === 'apply' ? 'Apply' : k === 'defer' ? 'Later' : 'Dismiss'}</button>)}
          </div> : null}
          {d?.decision === 'dismiss' && editable ? <input aria-label="Reason" placeholder="Reason (kept in history)" value={d.note || ''}
            onChange={e => setDec(x => ({ ...x, [c.id]: { ...d, note: e.target.value } }))} /> : null}
        </div>; })}
    </div>
    {late.length ? <p className="muted">{late.length} new comment{late.length > 1 ? 's' : ''} arrived after this review started. They stay pending for the next review.</p> : null}

    <label htmlFor="proc-instr"><b>What to change</b></label>
    <textarea id="proc-instr" rows={3} disabled={!editable} placeholder="e.g. Apply Teng's headline, keep Henry's visual" value={instructions} onChange={e => setInstructions(e.target.value)} />
    {editable ? <div className="row">
      <button className="btn primary" disabled={busy || (!nApply && !instructions.trim())}
        onClick={() => call('processing_approve', { p_id: active.id, p_rev: active.rev, p_decisions: decisions, p_instructions: instructions, p_queue_worker: true }, 'Approved · Claude will make the next version')}>
        Execute changes{nApply ? ` · ${nApply}` : ''}</button>
      <button className="btn" disabled={busy} onClick={() => call('processing_save_proposal', { p_id: active.id, p_rev: active.rev, p_proposal: draft }, 'Saved · pick it up here or in Claude')}>Save for later</button>
      <button className="btn quiet-danger" disabled={busy} onClick={() => call('processing_set_status', { p_id: active.id, p_rev: active.rev, p_status: 'cancelled', p_message: 'Cancelled in the app' }, 'Review cancelled · feedback stays pending')}>Cancel review</button>
    </div> : <div className="row">
      <span className="muted">{decisions.filter(d => d.decision === 'apply').length} to apply · {decisions.filter(d => d.decision === 'dismiss').length} to dismiss · undecided items stay pending</span>
      {active.status === 'approved' ? <button className="btn quiet-danger" disabled={busy} onClick={() => call('processing_set_status', { p_id: active.id, p_rev: active.rev, p_status: 'cancelled', p_message: 'Cancelled before execution' }, 'Cancelled · feedback stays pending')}>Cancel</button> : null}
    </div>}
  </div>;
}
