'use client';
import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { fmtDate, fmtSec } from '@/lib/data';

type Item = { author: string; body: string; at_sec: number | null; source: string; source_link: string | null; reason?: string | null; note?: string | null };
type Round = { reviewed_version: number | null; decided_by: string | null; note: string | null; accepted: Item[]; ignored: Item[] };
type Entry = { kind: 'version' | 'closed'; at: string; version_id?: string; version?: number; from_version?: number | null; made_by?: string; what_changed?: string | null; reverted_from?: number | null; round: Round | null };

const Quote = ({ i, why }: { i: Item; why?: string | null }) => <li>
  <b>{i.author}</b>{i.at_sec != null ? <span className="muted"> at {fmtSec(i.at_sec)}</span> : null}: {i.body === 'Voice note' ? <span className="muted">voice note</span> : i.body}
  {i.source_link ? <> <a className="muted" href={i.source_link} target="_blank" rel="noopener">Slack</a></> : null}
  {why ? <span className="muted"> · {why}</span> : null}
</li>;

/** What changed in each version, and which feedback went in or was set aside. Readable by the whole team. */
export default function ChangeLog({ assetId, refreshKey, onOpen }: { assetId: string; refreshKey: string; onOpen: (versionId: string) => void }) {
  const [log, setLog] = useState<Entry[] | null>(null);
  useEffect(() => { sb().rpc('change_log', { p_asset: assetId }).then(({ data }) => setLog((data as Entry[]) || [])); }, [assetId, refreshKey]);
  if (!log || !log.length) return null;
  return <section className="changelog" aria-label="Changes">
    <h2>Changes</h2>
    {log.map((e, k) => <div key={k} className="cl-entry">
      <div className="row">
        {e.kind === 'version' ? <button className="btn small" onClick={() => onOpen(e.version_id!)}>v{e.version}</button> : <span className="chip">No new version</span>}
        <span className="muted">{fmtDate(e.at)}{e.kind === 'version' ? ` · ${e.version === 1 ? 'first version' : e.reverted_from ? `reverted to v${e.reverted_from}` : `from v${e.from_version ?? '?'}`} · ${e.made_by}` : e.round?.decided_by ? ` · ${e.round.decided_by}` : ''}</span>
      </div>
      {e.what_changed ? <div>{e.what_changed}</div> : null}
      {e.round ? <>
        {e.round.accepted.length ? <div><span className="chip ok">Accepted · {e.round.accepted.length}</span><ul>{e.round.accepted.map((i, n) => <Quote key={n} i={i} />)}</ul></div> : null}
        {e.round.ignored.length ? <div><span className="chip">Ignored · {e.round.ignored.length}</span><ul>{e.round.ignored.map((i, n) => <Quote key={n} i={i} why={i.reason} />)}</ul></div> : null}
        {e.round.note ? <div className="muted">Note from {e.round.decided_by || 'the owner'}: {e.round.note}</div> : null}
      </> : null}
    </div>)}
  </section>;
}
