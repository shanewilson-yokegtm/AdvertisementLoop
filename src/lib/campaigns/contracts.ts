import * as z from 'zod';

export const PLAYBOOK_VERSION = 'yoke-campaigns-v1';
const text = z.string().trim().min(1).max(2000);
export const channelSchema = z.enum(['meta', 'linkedin']);
export const slugSchema = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/);
const date = z.string().datetime({ offset: true });
const url = z.string().url().refine(s => new URL(s).protocol === 'https:', 'Use an HTTPS destination');
export const audienceSchema = z.object({
  id: slugSchema, name: text, version: z.number().int().positive(), definition: text,
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1),
  include: z.array(text), exclude: z.array(text), expansion: z.enum(['off', 'on', 'platform_default']),
  sourceListRef: text.nullable(), estimatedSize: z.number().int().nonnegative().nullable(),
  matchedSize: z.number().int().nonnegative().nullable(), checkedAt: date.nullable(),
}).strict();
export const creativeSchema = z.object({
  conceptId: slugSchema, conceptName: text, assetId: z.string().min(3).max(120), versionId: z.string().min(3).max(120),
  primaryText: text, headline: text, cta: text, width: z.number().int().positive(), height: z.number().int().positive(),
  placements: z.array(text).min(1), adaptationNotes: text,
}).strict();
export const channelPlanSchema = z.object({
  channel: channelSchema, accountId: z.string().trim().min(1).max(100), identityId: text,
  objective: text, conversionEvent: text, attribution: text,
  audience: audienceSchema, placements: z.array(text).min(1),
  budget: z.object({ amount: z.number().positive(), type: z.enum(['daily', 'lifetime']), ceiling: z.number().positive(), bidStrategy: text }).strict(),
  destination: url, creatives: z.array(creativeSchema).min(1).max(20),
}).strict();
export const briefSchema = z.object({
  title: z.string().trim().min(1).max(150), purpose: text, hypothesis: text, offer: text,
  qualification: text, primaryOutcome: slugSchema, target: z.number().positive().nullable(),
  successRule: text, currency: z.string().regex(/^[A-Z]{3}$/), timezone: text,
  startsAt: date, spendEndsAt: date, analyzeAfter: date, totalCeiling: z.number().positive(),
  channels: z.array(channelPlanSchema).min(1).max(2),
  experiments: z.array(z.object({ rule: text, change: text, rationale: text }).strict()).max(20),
  heldConstant: z.array(text), limitations: z.array(text),
}).strict().superRefine((b, c) => {
  if (!(Date.parse(b.startsAt) < Date.parse(b.spendEndsAt) && Date.parse(b.spendEndsAt) <= Date.parse(b.analyzeAfter)))
    c.addIssue({ code: 'custom', message: 'Dates must follow start < spending end <= analysis date' });
  try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }); } catch { c.addIssue({ code: 'custom', message: 'Use an IANA timezone' }); }
  if (new Set(b.channels.map(p => p.channel)).size !== b.channels.length) c.addIssue({ code: 'custom', message: 'One plan per channel' });
  if (b.channels.reduce((n, p) => n + p.budget.ceiling, 0) > b.totalCeiling)
    c.addIssue({ code: 'custom', message: 'Channel ceilings exceed the campaign ceiling' });
  for (const p of b.channels) {
    if (p.budget.amount > p.budget.ceiling) c.addIssue({ code: 'custom', message: 'Budget amount exceeds its channel ceiling' });
    if (p.creatives.some(a => a.placements.some(s => !p.placements.includes(s))))
      c.addIssue({ code: 'custom', message: 'Creative placement is absent from the channel plan' });
    const ids = p.creatives.map(a => `${a.conceptId}:${a.versionId}`);
    if (new Set(ids).size !== ids.length) c.addIssue({ code: 'custom', message: 'Duplicate creative deployment' });
  }
});
export type Brief = z.infer<typeof briefSchema>;
export type Channel = z.infer<typeof channelSchema>;
export type ChannelPlan = z.infer<typeof channelPlanSchema>;
export type Actor = { user_id: string; role: 'viewer' | 'creator' | 'approver' | 'admin'; display_name: string };
export type Approval = { actor: string; at: string; fingerprint: string };
export type Launch = { id: string; fingerprint: string; actor: string; at: string; expiresAt: string; status: 'authorized' | 'blocked'; blockers: string[] };
export type CampaignState = {
  schemaVersion: 1; id: string; ownerId: string; title: string; revision: number;
  status: 'draft' | 'approved' | 'launch_authorized' | 'launch_blocked' | 'closed';
  playbookVersion: string; planningNotes: string; brief: Brief | null; approval: Approval | null; launch: Launch | null;
};
const counts = z.number().int().nonnegative();
export const metricRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), channel: channelSchema, accountId: text, platformAdId: text,
  conceptId: slugSchema.nullable(), audienceId: slugSchema.nullable(), versionId: text.nullable(), configurationRef: text.nullable(),
  spend: z.number().nonnegative(), impressions: counts, linkClicks: counts,
  platformResults: counts.nullable(), firstPartyOutcomes: counts.nullable(),
}).strict();
export const metricBatchSchema = z.object({
  sourceKey: slugSchema, sourceRef: text, currency: z.string().regex(/^[A-Z]{3}$/), timezone: text,
  firstPartyAssignment: z.enum(['not_supplied', 'deduplicated_single_deployment']),
  outcome: slugSchema, attribution: text, observedAt: date,
  windowStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), windowEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rows: z.array(metricRowSchema).max(1000),
}).strict().superRefine((b, c) => {
  if (b.windowStart > b.windowEnd || b.rows.some(r => r.date < b.windowStart || r.date > b.windowEnd))
    c.addIssue({ code: 'custom', message: 'Metric dates must be inside the reporting window' });
  const keys = b.rows.map(r => `${r.date}:${r.channel}:${r.accountId}:${r.platformAdId}`);
  if (new Set(keys).size !== keys.length) c.addIssue({ code: 'custom', message: 'Duplicate ad/day rows in this batch' });
  if (b.rows.some(r => r.firstPartyOutcomes != null) && b.firstPartyAssignment !== 'deduplicated_single_deployment')
    c.addIssue({ code: 'custom', message: 'First-party outcomes require a declared deduplicated, single-deployment assignment' });
});
export type MetricBatch = z.infer<typeof metricBatchSchema>;
export type MetricRow = z.infer<typeof metricRowSchema>;
export const observationSchema = z.object({
  channel: channelSchema, accountId: text, platformCampaignId: text, observedAt: date,
  externalActor: text.nullable(), sourceRef: text,
  settings: channelPlanSchema,
}).strict().refine(x => x.settings.channel === x.channel && x.settings.accountId === x.accountId, 'Observation account/channel mismatch');
export type Observation = z.infer<typeof observationSchema>;
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('save_notes'), notes: z.string().max(12000) }).strict(),
  z.object({ type: z.literal('save_brief'), brief: briefSchema }).strict(),
  z.object({ type: z.literal('approve'), fingerprint: text }).strict(),
  z.object({ type: z.literal('authorize_launch'), fingerprint: text, personConfirmed: z.literal(true) }).strict(),
  z.object({ type: z.literal('attempt_launch') }).strict(),
  z.object({ type: z.literal('observe'), observation: observationSchema }).strict(),
  z.object({ type: z.literal('import_metrics'), batch: metricBatchSchema }).strict(),
  z.object({ type: z.literal('close'), note: text }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
