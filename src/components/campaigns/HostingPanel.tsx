'use client';
import { useEffect, useState } from 'react';
import type { CampaignState } from '@/lib/campaigns/contracts';
import { emptyHostingBrief } from '@/lib/campaigns/hosting-contracts';
import type { HostingPacket } from '@/lib/campaigns/hosting';

type Packet = HostingPacket & { libraryCheckedAt: string };
export default function HostingPanel({ state, canEdit, pending, onCommand }: {state:CampaignState;canEdit:boolean;pending:boolean;
  onCommand:(command:Record<string,unknown>, revision?:number)=>Promise<boolean>|void}) {
  const [packet,setPacket] = useState<Packet|null>(null); const [error,setError] = useState('');
  const [editing,setEditing] = useState(false); const [memo,setMemo] = useState(''); const [revision,setRevision] = useState(0);
  const [copied,setCopied] = useState(false); const [refresh,setRefresh] = useState(0);
  const hasPreparation=!!state.preparation;
  useEffect(()=>{
    const controller = new AbortController(); setPacket(null); setError('');
    if (hasPreparation) fetch(`/api/campaigns/${state.id}/preparation`,{cache:'no-store',signal:controller.signal}).then(async r=>{
      const d=await r.json(); if (!r.ok) throw new Error(d.message || 'Preparation unavailable'); setPacket(d);
    }).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return ()=>controller.abort();
  },[state.id,state.revision,hasPreparation,refresh]);
  const start = ()=>{setMemo(state.preparation?.memo || state.planningNotes || '');setRevision(state.revision);setEditing(true);};
  const download=(name:string,body:string,type:string)=>{
    const url=URL.createObjectURL(new Blob([body],{type})); const a=document.createElement('a'); a.href=url;a.download=name;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const m=packet?.manifest;
  return <section aria-label="Campaign preparation">
    <h2>Prepare your market test</h2>
    <p>Save what you want to learn. Continue in Claude to resolve the business decisions and select exact Library versions. This prepares a review packet for your team.</p>
    <div className="row">
      <button className="btn primary" onClick={async()=>{try{
        await navigator.clipboard.writeText(`Use /ad-hosting v1.0.0 for campaign ${state.id}. Call whoami, campaign_hosting_guide, then campaign_get. Read the saved memo and preparation; ask only unresolved consequential questions together. Save through campaign_hosting_save with the current revision. Call campaign_prepare and show questions, exact versions, labels, tracking and the handoff. Prepare only; no platform changes or creative generation.`);setCopied(true);
      }catch{setError('Could not copy. Use /ad-hosting in Claude with campaign '+state.id);}}}>{copied?'Prompt copied':'Continue in Claude'}</button>
      {canEdit && state.status === 'draft' && !editing ? <button className="btn" disabled={pending} onClick={start}>{state.preparation?'Edit market-test memo':'Add market-test memo'}</button>:null}
      {state.preparation?<button className="btn" onClick={()=>setRefresh(n=>n+1)}>Refresh asset readiness</button>:null}
    </div>
    {editing?<form onSubmit={async e=>{e.preventDefault();if(revision!==state.revision||pending||!memo.trim())return;
      const base=state.preparation || emptyHostingBrief();
      if(await onCommand({type:'save_preparation',preparation:{...base,memo:memo.trim(),decisionsCurrent:false}},revision))setEditing(false);
    }}>
      <label>What do you want to test?<textarea value={memo} maxLength={12000} rows={8} onChange={e=>setMemo(e.target.value)}/></label>
      {revision!==state.revision?<p role="alert">A teammate saved a newer revision. Your draft is preserved. Copy it before cancelling and reopening the current memo.</p>:null}
      <button className="btn primary" disabled={pending||revision!==state.revision||!memo.trim()}>Save market-test memo</button>
      <button type="button" className="btn" disabled={pending} onClick={()=>setEditing(false)}>Cancel memo edit</button>
    </form>:state.preparation?<p style={{whiteSpace:'pre-wrap'}}>{state.preparation.memo}</p>:null}
    {error?<p role="alert">{error}</p>:null}
    {state.preparation&&!packet&&!error?<p role="status">Checking the selected Library versions…</p>:null}
    {m?<>
      <p><strong>{m.status==='ready_for_review'?'Ready for review':'Needs decisions or assets'}</strong> · {m.ads.length} ads · {m.ads.reduce((n,a)=>n+a.media.length,0)} renditions</p>
      <p>No platform upload, attachment or activation has been performed. Asset readiness checked {new Date(packet.libraryCheckedAt).toLocaleString()}.</p>
      {m.issues.length?<ul>{m.issues.map(i=><li key={i.id}><strong>{i.stage==='launch'?'Before launch':'To prepare'}:</strong> {i.message} <span className="muted">({i.owner.replaceAll('_',' ')})</span></li>)}</ul>:null}
      <p>Campaign label: <code>{m.campaignLabel}</code></p>
      {m.budget?<p>{m.budget.currency} {(m.budget.amountMinor/100).toFixed(2)} {m.budget.type} · total ceiling {m.budget.ceilingMinor?(m.budget.ceilingMinor/100).toFixed(2):'unconfirmed'}</p>:null}
      <div className="campaign-table"><table><thead><tr><th>Concept / variant</th><th>Media</th><th>Destination and tracking</th></tr></thead><tbody>
        {m.ads.map(a=><tr key={a.adKey}><th scope="row">{a.conceptKey} / {a.variantKey}<br/><small>{a.adKey}</small></th>
          <td>{a.media.map(r=><div key={r.format}><a href={r.libraryPath}>{r.format} · {r.libraryStatus.replaceAll('_',' ')}</a></div>)}</td>
          <td>{a.destination?<a href={a.destination} target="_blank" rel="noreferrer">Review tagged destination</a>:'Unresolved'}</td></tr>)}
      </tbody></table></div>
      <p className="muted">Excluded ad keys: {m.excludedAdKeys.join(', ')||'None'}. Exclusion here does not reject the Library asset.</p>
      <div className="row">
        <button className="btn" onClick={()=>download(`${state.id}.manifest.json`,JSON.stringify(m,null,2),'application/json')}>Download manifest</button>
        <button className="btn" onClick={()=>download(`${state.id}.csv`,packet.csv,'text/csv;charset=utf-8')}>Download analysis CSV</button>
        <button className="btn" onClick={()=>download(`${state.id}.handoff.md`,packet.markdown,'text/markdown;charset=utf-8')}>Download handoff</button>
        <button className="btn" onClick={async()=>{try{await navigator.clipboard.writeText(packet.markdown);}catch{setError('Clipboard unavailable. Download the handoff instead.');}}}>Copy handoff</button>
      </div>
      <details><summary>Version and verification</summary><p>Compiler {m.compilerVersion} · revision {m.revision}</p><p style={{overflowWrap:'anywhere'}}>Manifest hash: {m.manifestHash}</p><ul>{m.launchChecks.map(s=><li key={s}>{s}</li>)}</ul></details>
    </>:null}
  </section>;
}
