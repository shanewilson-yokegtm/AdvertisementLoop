import { createHash } from 'node:crypto';
import { HOSTING_VERSION, hostingBriefSchema, type HostingBrief } from './hosting-contracts';

const canonical = (v: any): string => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);
export const hostingHash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const token = (v: unknown) => hostingHash(v).slice(0, 24);
export type LibraryFact = { assetId: string; versionId: string; archived: boolean; kind: string; fileReady: boolean;
  width: number; height: number; approved: boolean; qaFailed: boolean; contentType: string | null };
type Issue = { id: string; message: string; owner: 'campaign_owner' | 'creative_owner' | 'publisher'; stage: 'preparation' | 'launch' };
const formats = { square: [1080,1080], feed45: [1080,1350], vertical: [1080,1920], landscape: [1200,628] } as const;
export const hostingConventions = {
  version: HOSTING_VERSION, identity: 'Analysis keys are explicit, saved once and independent of titles, order and platform names.',
  campaign: 'YOKE__<channel>__<product>__<campaign-key>__<record-token>',
  ad: '<campaign-label>__<concept>__<variant>__<content-token>',
  asset: 'YOKE__<product>__<concept>__<variant>__<kind>__<format>__<version-token>.<extension>',
  tracking: 'utm_campaign = saved campaign record ID; utm_content = exact deployment key; yoke_* fields retain readable dimensions.',
  formats, meaning: 'File variants are renditions of an ad, not additional concepts. Excluded ads remain in the plan as tombstones.',
  scope: 'Preparation only. No external upload, attachment, approval, activation or delivery is claimed.',
} as const;

/** Validate immutable joins and retain excluded identities; never rename an existing campaign on the platform. */
export function assertHostingContinuity(before: HostingBrief | null | undefined, after: HostingBrief) {
  if (!before) return;
  for (const k of ['initiativeKey','campaignKey','channel'] as const)
    if (before[k] !== null && before[k] !== after[k]) throw new Error(`${k} is fixed after its first deliberate selection. Create another campaign for a new identity.`);
  for (const old of before.ads) {
    const next = after.ads.find(a => a.key === old.key);
    if (!next) throw new Error(`Keep ${old.key} with disposition excluded instead of deleting its identity.`);
    if (old.conceptKey !== next.conceptKey || old.variantKey !== next.variantKey)
      throw new Error(`Ad ${old.key} already identifies another concept/variant. Exclude it and add a new ad key.`);
  }
}

/** Pure compiler: exact brief + version facts produce byte-identical artifacts, without network/clock/model calls. */
export function compileHosting(campaign: { id: string; title: string; revision: number }, input: HostingBrief, facts: LibraryFact[]) {
  const b = hostingBriefSchema.parse(input);
  const issues: Issue[] = [];
  const need = (id: string, message: string, stage: Issue['stage'] = 'preparation', owner: Issue['owner'] = 'campaign_owner') => {
    if (!issues.some(i=>i.id === id)) issues.push({id,message,stage,owner});
  };
  if (!b.decisionsCurrent) need('memo_interpretation','Reconcile this memo with the saved decisions in Claude before using the preparation packet.');
  for (const k of ['initiativeKey','campaignKey','channel'] as const) if (!b[k]) need(k,`Choose ${k} deliberately; it remains fixed after selection.`);
  for (const [field, prompt] of Object.entries({ hypothesis: 'What hypothesis should this test answer?', audienceKey: 'Choose an analysis key for the intended audience.',
    audienceDefinition: 'Who counts as the intended audience?', offer: 'What are we offering?', primaryOutcome: 'What outcome counts as success?',
    destination: 'Which destination should ads use?', budget: 'What budget and currency are authorized for this plan?' }))
    if (!b[field as keyof HostingBrief]) need(field, prompt);
  if (!b.countries.length) need('countries','Which countries should this target?');
  if (!b.timezone) need('timezone','Confirm the account timezone.','launch');
  if (!b.startsAt || !b.spendEndsAt) need('spending_window','Confirm start and spending end.','launch');
  if (!b.analyzeAfter) need('analysis_date','When should outcomes be evaluated?','launch');
  if (!b.budget?.ceilingMinor) need('spend_ceiling','Confirm a total spending ceiling. A daily budget alone is not a hard total cap.','launch');
  if (!b.experiment) need('experiment','Is this an ordinary creative comparison or a randomized experiment?');
  if (b.experiment?.kind === 'landing_page') {
    if (b.experiment.arms.length < 2) need('experiment_arms','A landing-page comparison needs at least two arms.');
    if (b.experiment.allocation === 'platform_optimized') need('experiment_allocation','Ordinary platform delivery cannot establish randomized page allocation.');
    if (!b.experiment.assignmentEvidenceRef) need('experiment_assignment','Implement and verify the page assignment before launch.','launch');
  }
  const campaignLabel = `YOKE__${b.channel || 'unresolved'}__${b.productKey}__${b.campaignKey || 'unresolved'}__${token(campaign.id).slice(0,10)}`;
  const included = b.ads.filter(a => a.disposition === 'included').sort((a,c) => a.key.localeCompare(c.key));
  if (!included.length) need('ads','Select at least one ad with exact Library versions.');
  const ads = included.map(a => {
    for (const k of ['primaryText','headline','cta'] as const) if (!a[k]) need(`${a.key}.${k}`,`Complete ${k} for ${a.key}.`);
    const sorted = [...a.renditions].sort((x,y) => x.format.localeCompare(y.format));
    const contentHash = hostingHash({kind:a.kind,primaryText:a.primaryText,headline:a.headline,cta:a.cta,renditions:sorted});
    const arm = b.experiment?.arms.find(arm=>arm.key === a.armKey);
    if (a.armKey && !arm) need(`${a.key}.arm`,'Selected experiment arm does not exist.');
    if (b.experiment && (b.experiment.allocation === 'native_experiment' || b.experiment.kind === 'creative_comparison' && b.experiment.arms.length > 1) && !arm)
      need(`${a.key}.arm`,'Assign this ad to an explicit experiment arm.');
    if (b.experiment?.kind === 'landing_page' && b.experiment.arms.some(arm=>!arm.destination))
      { if (!issues.some(i=>i.id==='arm_destinations')) need('arm_destinations','Supply a destination for every landing-page arm.'); }
    const entry = b.experiment?.allocation === 'native_experiment' && arm ? arm.destination : b.destination;
    const adKey = `yd_${token({campaign:campaign.id,ad:a.key,contentHash,armKey:a.armKey ?? null,audience:b.audienceKey,
      countries:[...b.countries].sort(),destination:entry,experiment:b.experiment})}`;
    const label = `${campaignLabel}__${a.conceptKey}__${a.variantKey}__${adKey.slice(-8)}`;
    if (label.length > 240) need(`${a.key}.label`,'Generated ad label exceeds the hosting convention limit.');
    const media = sorted.map(r => {
      const f = facts.find(f => f.versionId === r.versionId && f.assetId === r.assetId);
      if (!f || f.archived || !f.fileReady || f.qaFailed || (a.kind === 'static' ? f.kind !== 'static' : !['motion','video'].includes(f.kind)))
        need(`${a.key}.${r.format}.media`,`Resolve missing, archived, unfinished or mismatched media for ${a.key} / ${r.format}.`,'preparation','creative_owner');
      const [w,h] = formats[r.format];
      const extensions: Record<string,string> = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'};
      const extension = f?.contentType ? extensions[f.contentType] : null;
      if (f && (!extension || (a.kind === 'static' ? !f.contentType?.startsWith('image/') : !f.contentType?.startsWith('video/'))))
        need(`${a.key}.${r.format}.encoding`,`Verify the actual media encoding for ${a.key} / ${r.format}.`,'preparation','creative_owner');
      // Permit real exports at equivalent ratios, including the slightly rounded 1.91:1 landscape preset.
      if (f && (!f.width || !f.height || Math.abs(f.width/f.height - w/h) > 0.01))
        need(`${a.key}.${r.format}.dimensions`,`${a.key} / ${r.format} has incompatible dimensions; provide a composed rendition.`,'preparation','creative_owner');
      if (f && !f.approved) need(`${a.key}.${r.format}.approval`,`${a.key} / ${r.format} needs creative approval.`,'launch','creative_owner');
      return { ...r, width: f?.width ?? null, height: f?.height ?? null,
        filename: `YOKE__${b.productKey}__${a.conceptKey}__${a.variantKey}__${a.kind}__${r.format}__${token(r.versionId).slice(0,10)}.${extension || 'unverified'}`,
        contentType: f?.contentType ?? null,
        libraryStatus: !f ? 'missing' : f.archived ? 'archived' : !f.fileReady ? 'pending' : f.approved ? 'approved' : 'needs_review',
        platformUpload: 'not_observed', platformAttachment: 'not_observed', platformVerification: 'not_observed',
        libraryPath: `/a/${r.assetId}?v=${r.versionId}` };
    });
    for (const format of b.requiredFormats) if (!a.renditions.some(r => r.format === format))
      need(`${a.key}.${format}.missing`,`${a.key} needs a ${format} rendition or a deliberate placement-scope change.`,'preparation','creative_owner');
    let url: string | null = null;
    if (entry) {
      const u = new URL(entry);
      // This is a newly compiled recommendation, never an in-place edit to historical/live tracking.
      for (const k of [...u.searchParams.keys()]) if (/^utm_|^yoke_/i.test(k)) u.searchParams.delete(k);
      const tags = { utm_source:b.channel ?? 'unresolved',utm_medium:'paid_social',utm_campaign:campaign.id,utm_content:adKey,
        yoke_initiative:b.initiativeKey ?? 'unresolved',yoke_campaign:b.campaignKey ?? 'unresolved',yoke_audience:b.audienceKey ?? 'unresolved',yoke_concept:a.conceptKey,yoke_variant:a.variantKey,
        ...(a.armKey ? {yoke_arm:a.armKey} : {}) };
      Object.entries(tags).forEach(([k,v]) => u.searchParams.set(k,v)); url = u.href;
    }
    return { key:a.key,adKey,armKey:a.armKey,conceptKey:a.conceptKey,variantKey:a.variantKey,label,contentHash,kind:a.kind,
      primaryText:a.primaryText,headline:a.headline,cta:a.cta,destination:url,media };
  });
  // Only the referenced version facts enter the hash; unrelated Library changes do not churn artifacts.
  const used = new Set(ads.flatMap(a => a.media.map(m => `${m.assetId}:${m.versionId}`)));
  const pinnedFacts = facts.filter(f => used.has(`${f.assetId}:${f.versionId}`)).sort((x,y) => `${x.assetId}:${x.versionId}`.localeCompare(`${y.assetId}:${y.versionId}`));
  const manifest = { schemaVersion:1,compilerVersion:HOSTING_VERSION,campaignId:campaign.id,revision:campaign.revision,title:campaign.title,
    campaignLabel,initiativeKey:b.initiativeKey,campaignKey:b.campaignKey,productKey:b.productKey,audienceKey:b.audienceKey,channel:b.channel,
    inputHash:hostingHash({brief:b,library:pinnedFacts}),planHash:hostingHash(b),budget:b.budget,
    schedule:{timezone:b.timezone,startsAt:b.startsAt,spendEndsAt:b.spendEndsAt,analyzeAfter:b.analyzeAfter},
    memo:b.memo,audienceDefinition:b.audienceDefinition,
    experiment:b.experiment,countries:b.countries,hypothesis:b.hypothesis,offer:b.offer,primaryOutcome:b.primaryOutcome,
    status:issues.some(i => i.stage === 'preparation') ? 'needs_input' : 'ready_for_review',
    externalExecution:'not_performed',launchReady:false,
    issues,ads,excludedAdKeys:b.ads.filter(a => a.disposition === 'excluded').map(a => a.key).sort(),
    launchChecks:['Verify account, identity, conversion semantics, budget and schedule with the connected platform.',
      'Verify experiment assignment, destination, per-placement previews and approved exact versions.',
      'Obtain spending authorization for the exact connected-platform plan; this packet cannot authorize launch.'] };
  const manifestHash = hostingHash(manifest);
  const cell = (x: unknown) => { let s = String(x ?? ''); if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s; return '"'+s.replaceAll('"','""')+'"'; };
  const headers = ['campaign_id','campaign_key','initiative_key','channel','audience_key','ad_key','arm_key','concept_key','variant_key','content_hash','ad_label','format','asset_id','version_id','filename','destination','library_status','manifest_hash'];
  const rows = ads.flatMap(a => a.media.map(m => [campaign.id,b.campaignKey,b.initiativeKey,b.channel,b.audienceKey,a.adKey,a.armKey,a.conceptKey,a.variantKey,a.contentHash,a.label,m.format,m.assetId,m.versionId,m.filename,a.destination,m.libraryStatus,manifestHash]));
  const csv = [headers,...rows].map(row => row.map(cell).join(',')).join('\r\n')+'\r\n';
  const line = (x: string) => x.replace(/[\r\n]+/g,' ');
  const markdown = `# ${line(campaign.title)}\n\nHosting packet ${HOSTING_VERSION} · revision ${campaign.revision}\nCampaign ID: ${campaign.id}\nManifest: ${manifestHash}\n\n${ads.length} intended ads; ${rows.length} media renditions. Status: ${manifest.status}. No external campaign work performed.\n\nCampaign label: ${campaignLabel}\nBudget: ${b.budget ? `${b.budget.currency} ${(b.budget.amountMinor/100).toFixed(2)} ${b.budget.type}; total ceiling ${b.budget.ceilingMinor ? (b.budget.ceilingMinor/100).toFixed(2) : 'unconfirmed'}` : 'unconfirmed'}\n\n## Market test\n\nHypothesis: ${line(b.hypothesis || 'unconfirmed')}\nAudience: ${line(b.audienceDefinition || 'unconfirmed')}\nMarkets: ${b.countries.join(', ') || 'unconfirmed'}\nOffer: ${line(b.offer || 'unconfirmed')}\nOutcome: ${line(b.primaryOutcome || 'unconfirmed')}\nAllocation: ${b.experiment?.allocation || 'unconfirmed'}; arm weights are planning values, not evidence of delivered exposure.\n\n## Source memo\n\n${b.memo}\n\n## Questions and blockers\n\n${issues.map(i=>`- [${i.stage}; ${i.owner}; ${i.id}] ${line(i.message)}`).join('\n') || 'No preparation blockers. Launch checks still apply.'}\n\n## Intended ads\n\n${ads.map(a=>`- ${a.label}: ${a.media.length} renditions; ${a.destination || 'destination unresolved'}`).join('\n')}\n\n## Before platform launch\n\n${manifest.launchChecks.map(s=>'- '+s).join('\n')}\n`;
  return {manifest:{...manifest,manifestHash},csv,markdown};
}
export type HostingPacket = ReturnType<typeof compileHosting>;
