'use client';
import { useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { fmtDate, fmtSec, type Comment, type Version } from '@/lib/data';

const friendly = (e: any) => String(e?.message || e).replace(/^.*?: /, '');

/** One attributed thread for everyone. Owners/admins approve or reject each item (saved right away);
 *  approving an item only queues it for the next version. It is not final approval of the ad. */
export default function FeedbackThread({ comments, vs, manage, inFlight, nextVersion, who, audioUrls, toast, reload, children }: {
  comments: Comment[]; vs: Version[]; manage: boolean; inFlight: Set<string>; nextVersion: number;
  who: (id?: string | null, legacy?: string | null) => string; audioUrls: Record<string, string>; toast: (m: string) => void; reload: () => void; children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const vOf = (id?: string | null) => vs.find(x => x.id === id)?.version;
  const live = comments.filter(c => !c.deleted_at || c.status !== 'open');
  const open = live.filter(c => c.status === 'open' && !inFlight.has(c.id));
  const decided = live.filter(c => !(c.status === 'open' && !inFlight.has(c.id))).reverse();

  const decide = async (c: Comment, d: 'approved' | 'rejected' | 'undecided') => {
    setBusy(c.id);
    const { error } = await sb().rpc('feedback_decide', { p_comment: c.id, p_decision: d });
    if (error) toast(friendly(error));
    setBusy(null); reload();
  };

  const item = (c: Comment) => {
    const isOpen = c.status === 'open' && !inFlight.has(c.id);
    const yes = isOpen && c.decision === 'approved';
    const state = c.status === 'applied' ? <span className="chip ok">In v{vOf(c.applied_in) ?? '?'}</span>
      : inFlight.has(c.id) ? <span className="chip live">Going into v{nextVersion}</span>
      : c.status === 'dismissed' ? <span className="chip plain">Rejected</span>
      : !manage ? <span className="chip plain">{yes ? 'Approved for next version' : 'Waiting for owner'}</span> : null;
    return <li key={c.id} className={'fb' + (yes ? ' sel' : '') + (isOpen ? '' : ' done') + (c.status === 'dismissed' ? ' off' : '')}>
      <div className="by"><b>{who(c.author, c.legacy_author)}</b>
        <span className="muted">v{vOf(c.version_id) ?? '?'}{c.at_sec != null ? ` · at ${fmtSec(c.at_sec)}` : ''} · {fmtDate(c.created_at)}{c.source === 'slack' ? ' · Slack' : ''}</span></div>
      {c.audio_path ? <audio controls preload="none" src={audioUrls[c.audio_path]} aria-label={`Voice note from ${who(c.author, c.legacy_author)}`} /> : null}
      {c.audio_path && c.body === 'Voice note' ? <span className="muted">Voice note, no transcript</span> : <div className="body">{c.body}</div>}
      {c.resolution_note && c.status === 'dismissed' && c.resolution_note !== 'Rejected' ? <div className="muted small">Reason: {c.resolution_note}</div> : null}
      {c.deleted_at ? <div className="muted small">Deleted in Slack (kept for history)</div> : c.edited_at ? <div className="muted small">Edited in Slack</div> : null}
      <div className="ctl">
        <span className="row">{state}{c.source_link ? <a className="muted small" href={c.source_link} target="_blank" rel="noopener">View in Slack</a> : null}</span>
        {manage && isOpen ? <div className="decide" role="group" aria-label={`Use ${who(c.author, c.legacy_author)}’s feedback in the next version?`}>
          <button type="button" className="yes" aria-pressed={yes} disabled={!!busy} onClick={() => decide(c, yes ? 'undecided' : 'approved')}>Approve</button>
          <button type="button" className="no" disabled={!!busy} onClick={() => decide(c, 'rejected')}>Reject</button>
        </div> : null}
        {manage && c.status === 'dismissed' ? <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => decide(c, 'undecided')}>Undo</button> : null}
      </div>
    </li>;
  };

  // children: the owner's Regenerate bar, placed right after the items it acts on.
  if (!live.length) return <><p className="hint">No feedback yet.</p>{children}</>;
  return <>
    {open.length ? <ul className="thread" role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-label="Open feedback">{open.map(item)}</ul>
      : <p className="hint">{manage ? 'Nothing waiting for a decision.' : 'No open feedback.'}</p>}
    {children}
    {decided.length ? <details className="disc"><summary>Decided<span className="muted">{decided.length}</span></summary>
      <div className="inner"><ul className="thread" role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{decided.map(item)}</ul></div></details> : null}
  </>;
}
