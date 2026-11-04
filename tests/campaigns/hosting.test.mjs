import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const {emptyHostingBrief,hostingBriefSchema}=load('src/lib/campaigns/hosting-contracts.ts');
const {compileHosting,assertHostingContinuity}=load('src/lib/campaigns/hosting.ts');
const campaign={id:'yc_123456789012345678901234',title:'Fixture only',revision:2};
const ad=(key='upkeep_static')=>({key,conceptKey:'workflow_upkeep',variantKey:'original',kind:'static',disposition:'included',
  primaryText:'For workflow builders',headline:'The upkeep stayed',cta:'Learn more',renditions:[{format:'feed45',assetId:'fixture-asset',versionId:'fixture-asset_v1'}]});
export const fixture=()=>({...emptyHostingBrief('Test two messages for technical workflow builders.'),decisionsCurrent:true,
  initiativeKey:'gtme_test',campaignKey:'workflow_comparison',productKey:'yoke',channel:'meta',hypothesis:'Upkeep messaging earns qualified signups.',
  audienceKey:'gtme_builders',audienceDefinition:'Practitioners who build GTM workflows',offer:'An account and message preview',primaryOutcome:'qualified_signup',
  countries:['US'],destination:'https://example.test/preview?ref=partner&UTM_CONTENT=stale&utm_campaign=old#signup',
  budget:{currency:'CAD',amountMinor:20000,type:'daily',ceilingMinor:null},
  requiredFormats:['feed45'],experiment:{kind:'creative_comparison',allocation:'platform_optimized',arms:[{key:'shared',destination:'https://example.test/preview',weight:100}],assignmentEvidenceRef:null},ads:[ad()]});
const fact={assetId:'fixture-asset',versionId:'fixture-asset_v1',archived:false,kind:'static',fileReady:true,width:1080,height:1350,approved:true,qaFailed:false,contentType:'image/png'};
test('missing decisions are consolidated without inventing budget, identity, dates or approval',()=>{
  const p=compileHosting(campaign,emptyHostingBrief(),[]);
  assert.equal(p.manifest.budget,null);assert.equal(p.manifest.status,'needs_input');assert.equal(p.manifest.launchReady,false);
  assert.equal(p.manifest.externalExecution,'not_performed');assert.ok(p.manifest.issues.some(i=>i.id==='budget'));
  assert.equal(new Set(p.manifest.issues.map(i=>i.id)).size,p.manifest.issues.length);
  assert.equal(emptyHostingBrief().campaignKey,null);assert.equal(emptyHostingBrief().channel,null);
  assert.doesNotThrow(()=>assertHostingContinuity(emptyHostingBrief(),fixture()));
});
test('same pinned inputs compile identically; title changes preserve analysis joins and tracking',()=>{
  const b=fixture();const p=compileHosting(campaign,b,[fact]);
  assert.deepEqual(p,compileHosting(campaign,b,[fact]));assert.equal(p.manifest.status,'ready_for_review');
  const renamed=compileHosting({...campaign,title:'A clearer memo title',revision:3},b,[fact]);
  assert.equal(p.manifest.ads[0].adKey,renamed.manifest.ads[0].adKey);
  assert.equal(p.manifest.ads[0].destination,renamed.manifest.ads[0].destination);
  assert.equal(p.manifest.campaignLabel,renamed.manifest.campaignLabel);
  assert.notEqual(p.manifest.manifestHash,renamed.manifest.manifestHash);
  const u=new URL(p.manifest.ads[0].destination);assert.equal(u.searchParams.get('utm_campaign'),campaign.id);
  assert.equal(u.searchParams.get('ref'),'partner');assert.equal(u.hash,'#signup');assert.equal(u.searchParams.has('UTM_CONTENT'),false);
  assert.equal(u.searchParams.get('utm_content'),p.manifest.ads[0].adKey);
});
test('exported packet retains qualification and simulation authority without needing the original chat',()=>{
  const b=fixture();
  b.audienceDefinition='Personally builds GTM workflows; distinguish in-house from agency.';
  b.memo='SIMULATION ONLY: no spending authority. Draft copy needs product-truth review.\nCompare upkeep with setup.';
  const p=compileHosting(campaign,b,[fact]);
  const exported=JSON.parse(JSON.stringify(p.manifest));
  assert.equal(exported.audienceDefinition,b.audienceDefinition);
  assert.equal(exported.memo,b.memo);
  for(const value of [campaign.id,b.hypothesis,b.audienceDefinition,b.offer,b.primaryOutcome,b.memo,p.manifest.manifestHash])
    assert.ok(p.markdown.includes(value),`Handoff omitted ${value}`);
  assert.equal(exported.launchReady,false);
  assert.equal(exported.externalExecution,'not_performed');
});
test('ads remain stable through ordering, and copy/media revisions get distinct deployment keys',()=>{
  const b=fixture();b.ads.push({...ad('upkeep_b'),variantKey:'alternate'});
  const p=compileHosting(campaign,b,[fact]);const reordered=compileHosting(campaign,{...b,ads:[...b.ads].reverse()},[fact]);
  assert.deepEqual(p.manifest.ads,reordered.manifest.ads);
  assert.notEqual(p.manifest.ads[0].adKey,p.manifest.ads[1].adKey);
  const edited=structuredClone(b);edited.ads[0].headline='A different message';
  const changed=compileHosting(campaign,edited,[fact]);
  const originalAd=p.manifest.ads.find(a=>a.key==='upkeep_static'),changedAd=changed.manifest.ads.find(a=>a.key==='upkeep_static');
  assert.notEqual(originalAd.adKey,changedAd.adKey);assert.equal(originalAd.conceptKey,changedAd.conceptKey);
  const another=compileHosting({...campaign,id:'yc_ffffffffffffffffffffffff'},b,[fact]);assert.notEqual(p.manifest.ads[0].adKey,another.manifest.ads[0].adKey);
});
test('exclusion preserves identities and never changes or rejects the Library',()=>{
  const b=fixture(),excluded=structuredClone(b);excluded.ads[0].disposition='excluded';
  assert.doesNotThrow(()=>assertHostingContinuity(b,excluded));
  const p=compileHosting(campaign,excluded,[fact]);assert.equal(p.manifest.ads.length,0);assert.deepEqual(p.manifest.excludedAdKeys,['upkeep_static']);assert.equal(fact.archived,false);
  assert.throws(()=>assertHostingContinuity(b,{...b,ads:[]}),/instead of deleting/);
  assert.throws(()=>assertHostingContinuity(b,{...b,campaignKey:'renamed'}),/fixed/);
  assert.throws(()=>assertHostingContinuity(b,{...b,ads:[{...b.ads[0],conceptKey:'other_concept'}]}),/another concept/);
  assert.equal(hostingBriefSchema.safeParse({...b,ads:[b.ads[0],b.ads[0]]}).success,false);
  assert.equal(hostingBriefSchema.safeParse({...b,campaignKey:'Mixed-case'}).success,false);
});
test('renditions require matching real versions, encodings and ratios; uploads/attachments stay unknown',()=>{
  const b=fixture();b.requiredFormats.push('vertical');
  const p=compileHosting(campaign,b,[{...fact,approved:false}]);
  assert.ok(p.manifest.issues.some(i=>i.id==='upkeep_static.vertical.missing'));
  assert.ok(p.manifest.issues.some(i=>i.stage==='launch'&&i.id.endsWith('.approval')));
  assert.equal(p.manifest.ads[0].media[0].platformAttachment,'not_observed');
  for(const bad of [{...fact,assetId:'wrong-asset'},{...fact,archived:true},{...fact,qaFailed:true},{...fact,width:1080,height:1920},{...fact,contentType:'video/webm'}])
    assert.equal(compileHosting(campaign,fixture(),[bad]).manifest.status,'needs_input');
  const webp=compileHosting(campaign,fixture(),[{...fact,contentType:'image/webp'}]);assert.match(webp.manifest.ads[0].media[0].filename,/\.webp$/);
});
test('landing test wiring and budget limitations remain visible without blocking unrelated preparation',()=>{
  const b=fixture();b.experiment={kind:'landing_page',allocation:'randomized_router',assignmentEvidenceRef:null,arms:[
    {key:'expense',destination:'https://example.test/expense',weight:50},{key:'work',destination:'https://example.test/work',weight:50}]};
  const p=compileHosting(campaign,b,[fact]);assert.equal(p.manifest.status,'ready_for_review');
  assert.ok(p.manifest.issues.some(i=>i.id==='experiment_assignment'&&i.stage==='launch'));
  assert.ok(p.manifest.issues.some(i=>i.id==='spend_ceiling'));
  b.experiment.allocation='platform_optimized';assert.equal(compileHosting(campaign,b,[fact]).manifest.status,'needs_input');
  assert.equal(hostingBriefSchema.safeParse({...b,budget:{...b.budget,amountMinor:0.1}}).success,false);
});
test('CSV handles quotes, line breaks and spreadsheet formulas and carries the manifest hash',()=>{
  const b=fixture();b.destination='https://example.test/"quote"';
  const p=compileHosting({...campaign,id:'=SUM(1,2)'},b,[fact]);
  assert.match(p.csv,/"'=SUM\(1,2\)"/);assert.ok(p.csv.includes(p.manifest.manifestHash));
  const extra={...fact,versionId:'unused'};assert.deepEqual(p,compileHosting({...campaign,id:'=SUM(1,2)'},b,[extra,fact]));
});

test('draft-only hosting commands cannot approve or authorize spend',()=>{
  const {applyCommand}=load('src/lib/campaigns/workflow.ts');
  const initial={...campaign,ownerId:'creator',status:'draft',schemaVersion:1,playbookVersion:'yoke-campaigns-v1',planningNotes:'',brief:null,approval:null,launch:null};
  const actor={user_id:'creator',role:'creator',display_name:'Creator'};
  const saved=applyCommand(initial,{type:'save_preparation',preparation:fixture()},actor);
  assert.equal(saved.status,'draft');assert.equal(saved.approval,null);assert.equal(saved.launch,null);
  assert.throws(()=>applyCommand(initial,{type:'save_preparation',preparation:fixture()},{...actor,role:'viewer'}),/creator/);
  assert.throws(()=>applyCommand({...initial,status:'approved'},{type:'save_preparation',preparation:fixture()},actor),/draft campaign/);
});
test('semantic validation closes the gaps that JSON Schema cannot describe',()=>{
  const b=fixture();
  for(const changed of [
    {...b,requiredFormats:['feed45','feed45']},
    {...b,ads:[{...b.ads[0],renditions:[b.ads[0].renditions[0],b.ads[0].renditions[0]]}]},
    {...b,experiment:{...b.experiment,arms:[{key:'one',destination:null,weight:10}]}},
    {...b,budget:{...b.budget,ceilingMinor:1}},
    {...b,timezone:'Mars/Base'}, {...b,destination:'javascript:alert(1)'},
  ]) assert.equal(hostingBriefSchema.safeParse(changed).success,false);
});
test('creative/native arms map explicitly into exports and a changed audience cannot share a deployment join',()=>{
  const b=fixture();b.experiment={kind:'creative_comparison',allocation:'platform_optimized',assignmentEvidenceRef:null,
    arms:[{key:'upkeep',destination:null,weight:50},{key:'cost',destination:null,weight:50}]};
  assert.ok(compileHosting(campaign,b,[fact]).manifest.issues.some(i=>i.id==='upkeep_static.arm'));
  b.ads[0].armKey='upkeep';const p=compileHosting(campaign,b,[fact]);
  assert.equal(p.manifest.ads[0].armKey,'upkeep');assert.equal(new URL(p.manifest.ads[0].destination).searchParams.get('yoke_arm'),'upkeep');
  const changed=compileHosting(campaign,{...b,audienceKey:'sales_leaders'},[fact]);assert.notEqual(changed.manifest.ads[0].adKey,p.manifest.ads[0].adKey);
});
