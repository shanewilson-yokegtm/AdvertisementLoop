import { createHash } from 'node:crypto';
import { PLAYBOOK_VERSION, type Brief, type CampaignState, type Channel } from './contracts';

export const playbook = {
  version: PLAYBOOK_VERSION,
  defaults: {
    naming: 'YOKE_<campaign-id>_<channel>_<role>',
    tracking: 'utm_source=<channel>&utm_medium=paid_social&utm_campaign=<campaign-id>&utm_content=<concept-id>_<version-id>',
    structure: 'One prospecting delivery group per channel initially; additional groups require a documented experiment.',
    identity: 'Pin the exact approved Ad Studio version. Format adaptations remain linked to the parent concept.',
    objective: 'Use the real website waitlist completion event when receipt and optimization eligibility are verified.',
    quality: 'Qualification is defined in the memo; platform signups and qualified first-party outcomes stay separate.',
    launch: 'Create paused, verify account, identity, budget, targeting, event, destination, tags and every preview; activate only within the exact authorized plan.',
    exceptions: 'Record a changed default, rationale and held-constant choices in the memo before approval.',
  },
  requiredLiveEvidence: ['account_identity', 'event_receipt_and_eligibility', 'audience_controls_and_exclusions', 'asset_readiness', 'placement_previews', 'destination_and_tags', 'budget_and_schedule', 'post_launch_readback'],
} as const;

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const planFingerprint = (s: CampaignState) => digest({ campaignId: s.id, brief: s.brief, playbookVersion: s.playbookVersion });

export function deploymentPlan(s: CampaignState) {
  if (!s.brief) return [];
  return s.brief.channels.map(p => ({
    ...p, campaignName: `YOKE_${s.id}_${p.channel}_acquisition`,
    utmCampaign: s.id, creatives: p.creatives.map(a => {
      const destination = new URL(p.destination);
      const content = `asset_${digest({ assetId: a.assetId, versionId: a.versionId }).slice(0,24)}`;
      for (const [k, v] of Object.entries({ utm_source: p.channel, utm_medium: 'paid_social', utm_campaign: s.id, utm_content: content })) destination.searchParams.set(k, v);
      return { ...a, adName: `YOKE_${s.id}_${p.channel}_${a.conceptId}_${a.versionId}`, utmContent: content, destination: destination.href };
    }),
  }));
}

export function memoMarkdown(b: Brief) {
  const line = (s: string) => s.replace(/[\r\n]+/g, ' ');
  return `# ${line(b.title)}\n\n**Purpose:** ${line(b.purpose)}\n\n**Hypothesis:** ${line(b.hypothesis)}\n\n**Offer:** ${line(b.offer)}\n\n**Who qualifies:** ${line(b.qualification)}\n\n**Outcome:** ${b.primaryOutcome}${b.target == null ? '' : `; target ${b.target}`}\n\n**Decision rule:** ${line(b.successRule)}\n\n**Timing (${b.timezone}):** ${b.startsAt} → spend ends ${b.spendEndsAt}; analyze after ${b.analyzeAfter}\n\n**Budget ceiling:** ${b.currency} ${b.totalCeiling}\n\n${b.channels.map(p => `- **${p.channel}:** ${line(p.audience.name)} v${p.audience.version}; ${line(p.objective)} / ${line(p.conversionEvent)}; ${p.budget.type} ${p.budget.amount}, ceiling ${p.budget.ceiling}; ${p.creatives.length} creative versions; ${p.destination}`).join('\n')}\n\n**Experiments / departures:** ${b.experiments.length ? b.experiments.map(e => `${line(e.rule)}: ${line(e.change)} (${line(e.rationale)})`).join('; ') : 'Use playbook defaults.'}\n\n**Held constant:** ${b.heldConstant.map(line).join('; ')}\n\n**Known limitations:** ${b.limitations.map(line).join('; ') || 'None recorded.'}\n`;
}

export type Capability = { channel: Channel; connected: false; reason: string };
export const capabilities = (): Capability[] => (['meta', 'linkedin'] as const).map(channel => ({ channel, connected: false, reason: 'Firm account adapter is not connected. Configure and verify it during the Claude handoff.' }));
