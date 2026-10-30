'use client';
import { useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { fmtDate, fmtSec, type Comment, type Version } from '@/lib/data';

const friendly = (e: any) => String(e?.message || e).replace(/^.*?: /, '');
const list = { listStyle: 'none', padding: 0, margin: 0 } as const;

/** Long text: a short preview with an accessible toggle to read all of it. */
export function Clamp({ text, limit = 220 }: { text: string; limit?: number }) {
  const [open, setOpen] = useState(false);
  const long = text.length > limit || text.split('\n').length > 4;
  if (!long) return <div className="body">{text}</div>;
  return <div className="body">
    {open ? text : text.slice(0, limit).trimEnd() + '…'}{' '}
    <button type="button" className="linkish" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Show less' : 'Show all'}</button>
  </div>;
}

type Shared = {
  vs: Version[]; manage: boolean; who: (id?: string | null, legacy?: string | null) => string;
  audioUrls: Record<string, string>; toast: (m: string) => void; reload: () => void;
};

/** One attributed feedback card. Owners/admins approve or reject open items (saved right away); approving an item
 *  only queues it for the next version. It is not final approval of the ad. */
function useCard({ vs, manage, who, audioUrls, toast, reload }: Shared, opts: { latestVersion: number; inFlight?: Set<string>; nextVersion?: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const vOf = (id?: string | null) => vs.find(x => x.id === id)?.version;
  const decide = async (c: Comment, d: 'approved' | 'rejected' | 'undecided') => {
    setBusy(c.id);
    const { error } = await sb().rpc('feedback_decide', { p_comment: c.id, p_decision: d });
    if (error) toast(friendly(error));
    setBusy(null); reload();
  };
  return (c: Comment) => {
    const flying = !!opts.inFlight?.has(c.id);
    const isOpen = c.status === 'open' && !flying;
    const yes = isOpen && c.decision === 'approved';
    const ver = vOf(c.version_id);
    const older = isOpen && ver != null && ver < opts.latestVersion;
    const state = c.status === 'applied' ? <span className="chip ok">{vOf(c.applied_in) != null ? `Applied in v${vOf(c.applied_in)}` : 'Applied'}</span>
      : flying ? <span className="chip live">Going into v{opts.nextVersion}</span>
      : c.status === 'dismissed' ? <span className="chip plain">Rejected</span>
      : yes ? <span className="chip ok">Approved, not processed</span>
      : <span className="chip warn">{manage ? 'Needs decision' : 'Waiting for owner'}</span>;
    return <li key={c.id} className={'fb' + (yes ? ' sel' : '') + (isOpen ? '' : ' done') + (c.status === 'dismissed' ? ' off' : '')}>
      <div className="by"><b>{who(c.author, c.legacy_author)}</b>
        <span className="muted">v{ver ?? '?'}{c.at_sec != null ? ` · at ${fmtSec(c.at_sec)}` : ''} · {fmtDate(c.created_at)}{c.source === 'slack' ? ' · Slack' : ''}</span>
        {older ? <span className="chip warn">Still unprocessed · from v{ver}</span> : null}</div>
      {c.audio_path ? <audio controls preload="none" src={audioUrls[c.audio_path]} aria-label={`Voice note from ${who(c.author, c.legacy_author)}`} /> : null}
      {c.audio_path && c.body === 'Voice note' ? <span className="muted">Voice note, no transcript</span> : <Clamp text={c.body} />}
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
}

/** Feedback still to process (every open item, from any version), then anything going into the version being made. */
export default function FeedbackThread({ comments, inFlight, nextVersion, latestVersion, viewedVersionId, regen, progress, ...shared }: Shared & {
  comments: Comment[]; inFlight: Set<string>; nextVersion: number; latestVersion: number; viewedVersionId?: string;
  regen?: React.ReactNode; progress?: React.ReactNode;
}) {
  const card = useCard(shared, { latestVersion, inFlight, nextVersion });
  const live = comments.filter(c => !(c.deleted_at && c.status === 'open'));
  const pending = live.filter(c => c.status === 'open' && !inFlight.has(c.id));
  // The version being viewed comes first; open items from other versions stay counted and decidable in a closed group.
  const here = viewedVersionId ? pending.filter(c => c.version_id === viewedVersionId) : pending;
  const other = viewedVersionId ? pending.filter(c => c.version_id !== viewedVersionId) : [];
  const needs = here.filter(c => c.decision !== 'approved'), waiting = here.filter(c => c.decision === 'approved');
  const viewedN = shared.vs.find(v => v.id === viewedVersionId)?.version ?? latestVersion;
  const allOlder = other.every(c => (shared.vs.find(v => v.id === c.version_id)?.version ?? 0) < viewedN);
  const otherApproved = other.filter(c => c.decision === 'approved').length;
  const going = live.filter(c => c.status === 'open' && inFlight.has(c.id));
  return <>
    <section className="section" aria-labelledby="fpH">
      <div className="sechead"><h2 id="fpH">Feedback to process</h2><span className="muted small">{pending.length ? `${pending.length} open` : ''}</span></div>
      {!pending.length ? <p className="hint">{live.length ? 'Nothing waiting. Earlier feedback is under Previous runs and versions.' : 'No feedback yet.'}</p>
        : <p className="hint">{shared.manage ? 'Approve what should change, reject the rest, then regenerate. This is separate from approving the ad.' : 'The owner decides which feedback goes into the next version.'}</p>}
      {needs.length ? <div className="group"><h3>{shared.manage ? 'Needs decision' : 'Waiting for the owner'} · {needs.length}</h3><ul className="thread" role="list" style={list}>{needs.map(card)}</ul></div> : null}
      {waiting.length ? <div className="group"><h3>Approved, not processed yet · {waiting.length}</h3><ul className="thread" role="list" style={list}>{waiting.map(card)}</ul></div> : null}
      {other.length ? <details className="disc group" id="earlier">
        <summary>{allOlder ? 'Earlier feedback' : 'Feedback on other versions'} · still unprocessed<span className="muted">{other.length}{otherApproved ? ` · ${otherApproved} approved` : ''}</span></summary>
        <div className="inner"><ul className="thread" role="list" style={list}>{[...other].reverse().map(card)}</ul></div></details> : null}
      {regen}
    </section>
    {progress || going.length ? <section className="section" aria-labelledby="ipH">
      <div className="sechead"><h2 id="ipH">In progress</h2>{going.length ? <span className="muted small">{going.length} item{going.length === 1 ? '' : 's'}</span> : null}</div>
      {progress}
      {going.length ? <ul className="thread" role="list" style={list}>{going.map(card)}</ul> : null}
    </section> : null}
  </>;
}

type Run = { id: string; status: string; engine?: string; reviewed_version_id: string; result_version_id: string | null; comment_ids: string[];
  instructions: string | null; message: string | null; processor: string | null; started_by: string | null; updated_at: string; created_at: string };

/** One closed drawer: every earlier version (what changed, feedback applied in it, the run that made it), rejected
 *  feedback, runs that ended without a version, and shares. Built only from recorded applied_in / runs. */
export function PreviousRuns({ comments, runs, shares, onOpen, viewedVersionId, ...shared }: Shared & {
  comments: Comment[]; runs: Run[]; shares: any[]; onOpen: (versionId: string) => void; viewedVersionId?: string;
}) {
  const card = useCard(shared, { latestVersion: 0 });
  const { vs, who } = shared;
  const applied = comments.filter(c => c.status === 'applied'), rejected = comments.filter(c => c.status === 'dismissed').reverse();
  const ended = runs.filter(r => ['failed', 'cancelled'].includes(r.status)).reverse();
  const versions = [...vs].reverse();
  // Applied items whose applied_in is missing or not a loaded version are still history: never drop them.
  const unmatched = applied.filter(c => !vs.some(x => x.id === c.applied_in));
  const count = versions.length + rejected.length + ended.length + unmatched.length;
  return <details className="disc" id="history">
    <summary>Previous runs and versions<span className="muted">{vs.length} version{vs.length === 1 ? '' : 's'}{rejected.length ? ` · ${rejected.length} rejected` : ''}</span></summary>
    <div className="inner">
      {!count ? <p className="hint">Nothing yet.</p> : null}
      {versions.map(x => {
        const here = applied.filter(c => c.applied_in === x.id);
        const made = runs.filter(r => r.result_version_id === x.id);
        return <div key={x.id} className="hist">
          <div className="row"><button type="button" className="btn small" aria-current={x.id === viewedVersionId ? 'true' : undefined} onClick={() => onOpen(x.id)}>v{x.version}</button>
            {x.id === viewedVersionId ? <span className="chip plain">Viewing</span> : null}
            <span className="muted small">{fmtDate(x.created_at)} · {who(x.created_by, x.legacy_creator)}{x.parent_version_id ? ` · from v${vs.find(p => p.id === x.parent_version_id)?.version ?? '?'}` : ''}</span></div>
          {x.revision_note ? <Clamp text={x.revision_note} limit={160} /> : null}
          {made.map(r => <div key={r.id} className="muted small">Made from {r.comment_ids.length} approved item{r.comment_ids.length === 1 ? '' : 's'}{r.engine && r.engine !== 'worker' ? ` (${r.engine === 'claude' ? 'in Claude' : 'Higgsfield'})` : ''} · {fmtDate(r.updated_at)}{r.instructions ? ` · note: ${r.instructions}` : ''}</div>)}
          {here.length ? <ul className="thread" role="list" style={list} aria-label={`Feedback applied in v${x.version}`}>{here.map(card)}</ul> : null}
        </div>;
      })}
      {unmatched.length ? <div className="hist"><h3>Applied, version not recorded · {unmatched.length}</h3><ul className="thread" role="list" style={list}>{unmatched.map(card)}</ul></div> : null}
      {rejected.length ? <div className="hist"><h3>Rejected feedback · {rejected.length}</h3><ul className="thread" role="list" style={list}>{rejected.map(card)}</ul></div> : null}
      {ended.length ? <div className="hist"><h3>Runs that ended without a new version · {ended.length}</h3>
        {ended.map(r => <div key={r.id} className="muted small">{r.status === 'failed' ? 'Failed' : 'Cancelled'} · {fmtDate(r.updated_at)} · on v{vs.find(v => v.id === r.reviewed_version_id)?.version ?? '?'} · {r.comment_ids.length} item{r.comment_ids.length === 1 ? '' : 's'}{r.message ? ` · ${r.message}` : ''}</div>)}</div> : null}
      {shares.length ? <div className="hist"><h3>Shared</h3>{shares.slice(0, 10).map((s: any) => <div key={s.id} className="muted small">v{vs.find(x => x.id === s.version_id)?.version ?? '?'}{s.channel ? ' to ' + s.channel : ''} by {who(s.shared_by)} · {fmtDate(s.at)}</div>)}</div> : null}
    </div>
  </details>;
}
