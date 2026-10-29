'use client';
import { useEffect, useRef, useState } from 'react';
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
type Choice = 'apply' | 'dismiss';

const friendly = (e: any) => {
  const m = String(e?.message || e);
  if (/conflict/i.test(m)) return 'Someone else changed this or saved a new version. Reloaded.';
  return m.replace(/^.*?: /, '');
};

/** Owner view of feedback: Accept / Ignore each comment, then Make next version.
 *  Choices persist in the shared review record (the same one the owner's Claude reads). Nothing is built until the button is pressed. */
export default function ProcessFeedback({ a, vs, comments, proc, reload, who, audioUrls, toast, onOpen, ownerName }: {
  a: Asset; vs: Version[]; comments: Comment[]; proc: Processing | null; reload: () => void; who: (id?: string | null, legacy?: string | null) => string;
  audioUrls: Record<string, string>; toast: (m: string) => void; onOpen: (versionId: string) => void; ownerName: string;
}) {
  const open = comments.filter(c => c.status === 'open' && !c.deleted_at);
  const active = proc && ['reviewing', 'approved', 'executing'].includes(proc.status) ? proc : null;
  const [busy, setBusy] = useState(false);
  const [dec, setDec] = useState<Record<string, Choice>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState('');
  const rec = useRef<Processing | null>(active);
  useEffect(() => { rec.current = active; }, [active?.id, active?.rev]); // eslint-disable-line

  // Load saved choices (from the app or the owner's Claude).
  useEffect(() => {
    if (!active) return;
    const src = active.status === 'reviewing' ? (active.proposal?.draft?.decisions || []) : active.decisions;
    const d: Record<string, Choice> = {}; const n: Record<string, string> = {};
    (src || []).forEach(x => { if (x.decision === 'apply' || x.decision === 'dismiss') d[x.comment_id] = x.decision; if (x.note) n[x.comment_id] = x.note; });
    setDec(d); setNotes(n);
    setExtra((active.status === 'reviewing' ? active.proposal?.draft?.instructions : active.instructions) || '');
  }, [active?.id, active?.rev]); // eslint-disable-line

  const decisions = (d = dec, n = notes): Decision[] => Object.entries(d).map(([comment_id, decision]) => ({ comment_id, decision, ...(n[comment_id] ? { note: n[comment_id] } : {}) }));
  const rpc = async (fn: string, args: Record<string, any>) => {
    const { data, error } = await sb().rpc(fn, args);
    if (error) throw error;
    return data as Processing;
  };
  /** Start the review on first choice, then save choices as a draft. */
  const persist = async (d: Record<string, Choice>, n: Record<string, string>, ex: string) => {
    try {
      let p = rec.current;
      if (!p) { p = await rpc('processing_start', { p_asset: a.id, p_via: 'app' }); }
      if (p.status !== 'reviewing') return;
      const inReview = new Set(p.comment_ids);
      const draft = { ...(p.proposal || {}), draft: { decisions: decisions(d, n).filter(x => inReview.has(x.comment_id)), instructions: ex } };
      rec.current = await rpc('processing_save_proposal', { p_id: p.id, p_rev: p.rev, p_proposal: draft });
    } catch (e) { toast(friendly(e)); reload(); }
  };
  const choose = (id: string, c: Choice) => {
    const d = { ...dec }; if (d[id] === c) delete d[id]; else d[id] = c;
    setDec(d); persist(d, notes, extra);
  };

  if (active && active.status !== 'reviewing') {
    const n = vs.find(v => v.id === active.reviewed_version_id)?.version;
    const applied = active.decisions.filter(d => d.decision === 'apply').length;
    return <div className="panel" role="status">
      <div className="row" style={{ justifyContent: 'space-between' }}><h3>Next version</h3>
        <span className="chip">{active.status === 'executing' ? `Claude is making v${(n || 0) + 1}` : `Queued · v${(n || 0) + 1} arrives within the hour`}</span></div>
      <p className="muted">{applied} accepted comment{applied === 1 ? '' : 's'}{active.instructions ? ' + your note' : ''}. Ignored ones are closed; anything undecided stays open.</p>
      {active.status === 'approved' ? <div><button className="btn quiet-danger" disabled={busy} onClick={async () => {
        setBusy(true); try { await rpc('processing_set_status', { p_id: active.id, p_rev: active.rev, p_status: 'cancelled', p_message: 'Cancelled before Claude started' }); toast('Cancelled · comments stay open'); } catch (e) { toast(friendly(e)); } setBusy(false); reload();
      }}>Cancel</button></div> : null}
    </div>;
  }

  const last = proc && ['done', 'failed'].includes(proc.status) ? proc : null;
  const lastOut = last?.result_version_id ? vs.find(v => v.id === last.result_version_id) : null;
  const inReview = active ? new Set(active.comment_ids) : null;
  const decidable = open.filter(c => !inReview || inReview.has(c.id));
  const late = inReview ? open.filter(c => !inReview.has(c.id)) : [];
  const nAccept = decidable.filter(c => dec[c.id] === 'apply').length, nIgnore = decidable.filter(c => dec[c.id] === 'dismiss').length;
  const latest = vs[vs.length - 1];

  return <section className="panel" aria-label="Feedback on your ad">
    <div className="row" style={{ justifyContent: 'space-between' }}><h3>Feedback to process · {open.length}</h3>
      {active && active.processor && active.history.some(h => h.event === 'takeover') ? <span className="muted">processing: {who(active.processor)}</span> : null}</div>
    {last ? <div className="row" role="status"><span className={'chip ' + (last.status === 'done' ? 'ok' : 'warn')}>{last.status === 'done' ? `v${lastOut?.version ?? ''} ready` : 'Last revision failed'}</span>
      {lastOut ? <button className="btn small" onClick={() => onOpen(lastOut.id)}>View v{lastOut.version}</button> : null}
      {last.status === 'failed' && last.message ? <span className="muted">{last.message}</span> : null}</div> : null}
    {!open.length ? <p className="muted">No open feedback.</p> : <>
      <p className="muted">Accept what should go into v{(latest?.version || 0) + 1}. Ignore the rest. Nothing changes until you press Make next version{a.archived ? '' : ', which also takes an approved ad back into review'}.</p>
      {decidable.map(c => { const cv = vs.find(x => x.id === c.version_id); const d = dec[c.id];
        return <div key={c.id} className={'cmt decide' + (d ? ' ' + d : '')}>
          <div className="row"><b>{who(c.author, c.legacy_author)}</b><span className="muted">v{cv?.version ?? '?'}{c.at_sec != null ? ' · at ' + fmtSec(c.at_sec) : ''} · {fmtDate(c.created_at)}{c.source === 'slack' ? ' · Slack' : ''}</span></div>
          {c.audio_path ? <audio controls preload="none" src={audioUrls[c.audio_path]} style={{ width: '100%' }} aria-label="Voice note" /> : null}
          {c.audio_path && c.body === 'Voice note' ? <span className="muted">No transcript</span> : <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>}
          <div className="seg" role="radiogroup" aria-label="Use this comment?">
            <button type="button" role="radio" aria-checked={d === 'apply'} disabled={busy} onClick={() => choose(c.id, 'apply')}>Accept</button>
            <button type="button" role="radio" aria-checked={d === 'dismiss'} disabled={busy} onClick={() => choose(c.id, 'dismiss')}>Ignore</button>
          </div>
          {d === 'dismiss' ? <input aria-label="Why (optional)" placeholder="Why (optional, kept in history)" value={notes[c.id] || ''}
            onChange={e => setNotes(x => ({ ...x, [c.id]: e.target.value }))} onBlur={() => persist(dec, notes, extra)} /> : null}
        </div>; })}
      {late.length ? <p className="muted">{late.length} newer comment{late.length > 1 ? 's' : ''} came in after you started choosing. {late.length > 1 ? 'They' : 'It'} stay open for the next version.</p> : null}
      <label htmlFor="proc-instr" className="muted">Anything else to change (optional)</label>
      <textarea id="proc-instr" rows={2} placeholder="e.g. keep Henry’s visual, use Teng’s headline" value={extra} onChange={e => setExtra(e.target.value)} onBlur={() => persist(dec, notes, extra)} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted" role="status">{nAccept} accepted · {nIgnore} ignored · {decidable.length - nAccept - nIgnore} not decided</span>
        <button className="btn primary" disabled={busy || (!nAccept && !extra.trim() && !nIgnore)} onClick={async () => {
          setBusy(true);
          try {
            let p = rec.current || await rpc('processing_start', { p_asset: a.id, p_via: 'app' });
            const ids = new Set(p.comment_ids);
            const final = decisions().filter(x => ids.has(x.comment_id));
            p = await rpc('processing_approve', { p_id: p.id, p_rev: p.rev, p_decisions: final, p_instructions: extra, p_queue_worker: true });
            toast(nAccept || extra.trim() ? `Sent · v${(latest?.version || 0) + 1} arrives in the Library within the hour` : 'Ignored comments closed');
          } catch (e) { toast(friendly(e)); }
          setBusy(false); reload();
        }}>{!nAccept && !extra.trim() && nIgnore ? 'Close ignored' : 'Make next version'}</button>
      </div>
    </>}
  </section>;
}
