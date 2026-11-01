'use client';
import { useState } from 'react';
import type { CampaignState } from '@/lib/campaigns/contracts';

type Props = { state: CampaignState; memo: string | null; fingerprint: string; canApprove: boolean;
  pending: boolean; onCommand: (command: Record<string, unknown>) => void; audit: any; performance: any; closeout: any;
  groupBy: string; onGroupBy: (s: string) => void; from: string; to: string; onFrom: (s: string) => void; onTo: (s: string) => void };
const pretty = (s: string) => s.replaceAll('_',' ');
const value = (v: number | null | undefined) => v == null ? 'Unavailable' : new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(v);
export default function CampaignView(p: Props) {
  const [view, setView] = useState('Memo'); const [copied, setCopied] = useState(false);
  const s = p.state;
  return <section>
    <div className="head"><div><h1>{s.title}</h1><p className="muted">Revision {s.revision} · {s.playbookVersion} · <span className="chip">{pretty(s.status)}</span></p></div>
      <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(`Use the Yoke campaign-operator skill to continue campaign ${s.id}. Read the shared record first. Help me reach an approved one-page campaign memo.`); setCopied(true); } catch { setCopied(false); window.alert(`Continue campaign ${s.id} with the campaign-operator skill in Claude.`); } }}>{copied ? 'Prompt copied' : 'Continue in Claude'}</button>
    </div>
    <nav className="tabs" aria-label="Campaign views">{['Memo','Execution','Audit','Performance','Closeout'].map(t => <button key={t} aria-pressed={view === t} onClick={() => setView(t)}>{t}</button>)}</nav>
    {view === 'Memo' ? <>
      <p>The planning conversation happens in Claude. Everyone works from this saved memo and revision.</p>
      {p.memo ? <div className="campaign-memo">{p.memo.split('\n').filter(Boolean).map((line,i) => <p key={i}>{line.replace(/^#+\s*/, '').replaceAll('**','')}</p>)}</div> : <p>No complete memo yet. Continue in Claude to agree the audience, offer, concepts, budget and measurement.</p>}
      {s.planningNotes ? <details className="campaign-memo"><summary>Planning notes and open decisions</summary><p style={{whiteSpace:'pre-wrap'}}>{s.planningNotes}</p></details> : null}
      {p.canApprove && s.brief && s.status !== 'closed' ? <button className="btn primary" disabled={p.pending || !!s.approval} onClick={() => p.onCommand({ type: 'approve', fingerprint: p.fingerprint })}>{s.approval ? 'Memo approved' : 'Approve this memo'}</button> : null}
      {s.approval ? <p className="muted">Approved {new Date(s.approval.at).toLocaleString()}. Launch authorization is recorded separately when you say go.</p> : null}
    </> : null}
    {view === 'Execution' ? <>
      <h2>Account connections pending</h2><p>Meta and LinkedIn execution adapters are not connected. No campaign can launch from this scaffold.</p>
      {s.launch ? <p>Launch request: {pretty(s.launch.status)} · expires {new Date(s.launch.expiresAt).toLocaleString()}</p> : null}
      {s.launch?.blockers.map(b => <p key={b} role="status">{b}</p>)}
      {s.brief?.channels.map(c => <article key={c.channel} className="campaign-memo"><h3>{c.channel} · {c.objective}</h3>
        <p>{c.audience.name} v{c.audience.version} · {c.audience.countries.join(', ')} · expansion {c.audience.expansion}</p>
        <p>{s.brief!.currency} {c.budget.amount} {c.budget.type} · ceiling {c.budget.ceiling} · {c.creatives.length} exact creative versions</p>
        <p>{c.placements.join(', ')} · {c.conversionEvent}</p>
      </article>)}
    </> : null}
    {view === 'Audit' ? <>
      <h2>Observed settings and changes</h2><p>Manual imports retain the memo as it existed when the evidence was saved.</p>
      {!p.audit ? <p>Audit evidence unavailable.</p> : !p.audit.items?.length ? <p>No settings observations imported yet.</p> : p.audit.items.map((o: any) => <article key={o.id} className="campaign-memo">
        <h3>{o.data.channel} · {o.audit.status}</h3><p>{o.provenance} · compared to {pretty(o.audit.basis || 'no_plan')} · observed {new Date(o.data.observedAt).toLocaleString()}</p>
        <p>Platform editor: {o.data.externalActor || 'Unknown'} · evidence: {o.data.sourceRef}</p>
        {o.audit.changes.map((c: any) => <details key={c.field}><summary>{c.field} differs</summary><p>Planned</p><pre>{JSON.stringify(c.planned,null,2)}</pre><p>Observed</p><pre>{JSON.stringify(c.observed,null,2)}</pre></details>)}
      </article>)}
      {p.audit?.hasMore ? <p>Showing the latest 100 observations.</p> : null}
    </> : null}
    {view === 'Performance' ? <>
      <h2>Performance</h2><div className="row"><label>Group by <select value={p.groupBy} onChange={e=>p.onGroupBy(e.target.value)}>{['concept','channel','audience','version'].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
        <label>From <input type="date" value={p.from} onChange={e=>p.onFrom(e.target.value)} /></label><label>Through <input type="date" value={p.to} onChange={e=>p.onTo(e.target.value)} /></label></div>
      <p className="muted">{p.performance?.state || 'Unavailable'} · {p.performance?.currency || 'Currency pending'} · {p.performance?.outcome || 'Outcome pending'}</p>
      {!p.performance?.rows?.length ? <p>No comparable performance data is available. Missing data is not zero.</p> : <div className="campaign-table"><table><thead><tr><th>{p.groupBy} / channel</th><th>Spend</th><th>Impressions</th><th>Link clicks</th><th>Platform results</th><th>First-party outcomes</th></tr></thead><tbody>
        {p.performance.rows.map((r: any) => <tr key={r.label}><th scope="row">{r.label}</th><td>{value(r.spend)}</td><td>{value(r.impressions)}</td><td>{value(r.linkClicks)}</td><td>{value(r.platformResults)}</td><td>{value(r.firstPartyOutcomes)}</td></tr>)}
      </tbody></table></div>}
      {p.performance?.caveats?.map((c: string) => <p className="muted" key={c}>{c}</p>)}
      {p.performance?.detail?.length ? <details><summary>Delivery rows and configuration references</summary><div className="campaign-table"><table><thead><tr><th>Date</th><th>Channel</th><th>Ad</th><th>Creative version</th><th>Settings evidence</th></tr></thead><tbody>
        {p.performance.detail.slice(0,100).map((r: any,i: number)=><tr key={i}><td>{r.date}</td><td>{r.channel}</td><td>{r.platformAdId}</td><td>{r.versionId || 'Unclassified'}</td><td>{r.configurationRef || 'Unavailable'}</td></tr>)}
      </tbody></table></div>{p.performance.detail.length > 100 ? <p>Showing the first 100 delivery rows.</p> : null}</details> : null}
    </> : null}
    {view === 'Closeout' ? <>
      <h2>Campaign learning review</h2><p>Analysis date: {s.brief?.analyzeAfter ? new Date(s.brief.analyzeAfter).toLocaleString() : 'Set in the memo'}</p>
      <p>No scheduled worker is enabled yet. The evidence packet can be read on demand.</p>
      {p.closeout ? <><p>Status: {pretty(p.closeout.status)}</p><h3>What remains unproven</h3><ul>{p.closeout.unproven.map((x: string) => <li key={x}>{x}</li>)}</ul><p>Claude uses this evidence and the audit history to write the closeout memo. Recommendations remain proposals for the next round.</p></> : <p>Closeout evidence unavailable.</p>}
    </> : null}
  </section>;
}
