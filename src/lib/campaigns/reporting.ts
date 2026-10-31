import type { CampaignState, MetricBatch, MetricRow, Observation } from './contracts';
import { digest } from './playbook';

export function auditPlan(state: CampaignState, observation: Observation) {
  const planned = state.brief?.channels.find(p => p.channel === observation.channel);
  if (!planned) return { status: 'unplanned', changes: [], note: 'No approved plan for this channel; classify this manual campaign.' };
  const changes: { field: string; planned: unknown; observed: unknown }[] = [];
  for (const key of Object.keys(planned) as (keyof typeof planned)[]) {
    if (digest(planned[key]) !== digest(observation.settings[key])) changes.push({ field: key, planned: planned[key], observed: observation.settings[key] });
  }
  return { status: changes.length ? 'differs' : 'matches', basis: state.approval ? 'approved_memo' : 'saved_draft', changes,
    note: 'Manual import compared to the captured memo. The submitter is known; the platform editor is unknown unless supported by supplied evidence.' };
}

export type StoredBatch = { id: string; created_at: string; data: MetricBatch };
export function report(state: CampaignState, batches: StoredBatch[], groupBy: 'concept' | 'channel' | 'audience' | 'version' = 'concept', from?: string, to?: string) {
  // A sourceKey represents a stable import stream. A corrected row replaces that stream’s earlier ad/day row.
  // Never add duplicate streams for the same ad/day. Reject conflicting sources rather than inventing a total.
  const latest = new Map<string, { row: MetricRow; source: string; attribution: string }>();
  for (const batch of [...batches].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    for (const row of batch.data.rows) {
      if ((from && row.date < from) || (to && row.date > to)) continue;
      latest.set(`${batch.data.sourceKey}:${row.date}:${row.channel}:${row.accountId}:${row.platformAdId}`, { row, source: batch.data.sourceKey, attribution: batch.data.attribution });
    }
  }
  const duplicateKeys = new Map<string, string>(); const conflicts: string[] = [];
  for (const { row: r, source } of latest.values()) {
    const k = `${r.date}:${r.channel}:${r.accountId}:${r.platformAdId}`;
    if (duplicateKeys.has(k) && duplicateKeys.get(k) !== source) conflicts.push(k);
    duplicateKeys.set(k, source);
  }
  const definitions = [...new Set([...latest.values()].map(x => x.attribution))];
  const groups = new Map<string, { label: string; channel: string; attribution: string; spend: number; impressions: number; linkClicks: number; platformResults: number | null; firstPartyOutcomes: number | null; rows: number }>();
  if (!conflicts.length) for (const { row: r, attribution } of latest.values()) {
    const label = groupBy === 'channel' ? r.channel : groupBy === 'audience' ? r.audienceId || 'unclassified' : groupBy === 'version' ? r.versionId || 'unclassified' : r.conceptId || 'unclassified';
    // Platform results remain split by channel and attribution, even when comparing concepts.
    const key = `${label}:${r.channel}:${attribution}`;
    const g = groups.get(key) || { label: `${groupBy === 'channel' ? label : `${label} · ${r.channel}`} · ${attribution}`, channel: r.channel, attribution, spend: 0, impressions: 0, linkClicks: 0, platformResults: 0, firstPartyOutcomes: 0, rows: 0 };
    g.spend += r.spend; g.impressions += r.impressions; g.linkClicks += r.linkClicks; g.rows++;
    g.platformResults = g.platformResults == null || r.platformResults == null ? null : g.platformResults + r.platformResults;
    g.firstPartyOutcomes = g.firstPartyOutcomes == null || r.firstPartyOutcomes == null ? null : g.firstPartyOutcomes + r.firstPartyOutcomes;
    groups.set(key, g);
  }
  return {
    state: conflicts.length ? 'conflicting' : batches.length ? 'manual_import' : 'unavailable',
    currency: state.brief?.currency ?? null, timezone: state.brief?.timezone ?? null, outcome: state.brief?.primaryOutcome ?? null,
    groupBy, from: from || null, to: to || null,
    attribution: definitions, conflicts, latestImportAt: batches.map(b => b.created_at).sort().at(-1) || null,
    rows: [...groups.values()].map(g => ({ ...g, ctr: g.impressions ? g.linkClicks / g.impressions : null,
      cpc: g.linkClicks ? g.spend / g.linkClicks : null, costPerPlatformResult: g.platformResults ? g.spend / g.platformResults : null,
      costPerFirstPartyOutcome: g.firstPartyOutcomes ? g.spend / g.firstPartyOutcomes : null })),
    caveats: ['Manual imports are not a verified live connection.', 'First-party outcomes must be assigned once per person to one deployment before importing; platform attribution is separate.',
      'Delivery differences across audiences, dates and placements can confound concept comparisons.', 'Attribution definitions stay visible and are never blended across groups.', 'Configuration references identify the settings evidence for each ad/day.'],
    detail: [...latest.values()].map(x => x.row),
  };
}

export function closeout(state: CampaignState, batches: StoredBatch[], now = new Date()) {
  const b = state.brief;
  const localDay = (s: string) => {
    const parts = new Intl.DateTimeFormat('en', {timeZone:b!.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(s));
    const get = (type: string) => parts.find(p=>p.type===type)!.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  const result = report(state, batches, 'concept', b ? localDay(b.startsAt) : undefined, b ? localDay(b.spendEndsAt) : undefined);
  const usable = result.state === 'manual_import' && result.rows.length > 0;
  const complete = usable && result.rows.every(r => r.firstPartyOutcomes != null);
  const outcomes = complete ? result.rows.reduce((n, r) => n + (r.firstPartyOutcomes || 0), 0) : null;
  const due = !!b && now.getTime() >= Date.parse(b.analyzeAfter);
  return {
    campaignId: state.id, revision: state.revision, due, scheduledFor: b?.analyzeAfter ?? null,
    status: !due ? 'not_due' : !usable ? 'insufficient_evidence' : 'ready_for_human_review',
    hypothesis: b?.hypothesis ?? null, decisionRule: b?.successRule ?? null, observedOutcomes: outcomes,
    targetReached: outcomes != null && b?.target != null ? outcomes >= b.target : null,
    learned: usable ? ['Imported delivery and cost are available for the recorded concepts and channels.'] : [],
    unproven: [!complete ? 'Qualified first-party outcome totals are incomplete.' : 'Cross-channel deduplication relies on the importer’s declared single-assignment rule.',
      'This report does not establish a causal concept or channel winner.', 'Daily imports cannot separate intraday start/end boundaries; inspect the deployment receipts for partial days.', ...(!due ? ['The declared outcome-maturity window has not ended.'] : []), ...(b?.limitations || [])],
    nextRoundConsiderations: ['Review delivery, qualification and configuration changes against the memo before choosing the next experiment.'],
    report: result,
  };
}
