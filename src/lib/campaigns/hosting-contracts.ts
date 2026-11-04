import * as z from 'zod';

export const HOSTING_VERSION = '1.0.1';
export const analysisKey = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use a lowercase analysis key: letters, numbers and underscores, 2–40 characters');
const text = z.string().trim().min(1).max(2000);
const id = z.string().regex(/^[A-Za-z0-9_-]{3,120}$/);
const instant = z.string().datetime({ offset: true });
const destination = z.string().url().regex(/^https:\/\//, 'Use HTTPS').refine(s => { const u = new URL(s); return !u.username && !u.password; }, 'Use an HTTPS URL without credentials');
export const renditionSchema = z.object({
  format: z.enum(['square', 'feed45', 'vertical', 'landscape']), assetId: id, versionId: id,
}).strict();
export const hostingAdSchema = z.object({
  key: analysisKey, conceptKey: analysisKey, variantKey: analysisKey, armKey: analysisKey.nullable().default(null),
  kind: z.enum(['static', 'motion']), disposition: z.enum(['included', 'excluded']),
  primaryText: text.nullable(), headline: text.nullable(), cta: z.string().trim().min(1).max(80).nullable(),
  renditions: z.array(renditionSchema).max(4),
}).strict().superRefine((a, c) => {
  if (new Set(a.renditions.map(r => r.format)).size !== a.renditions.length)
    c.addIssue({ code: 'custom', message: 'Use one exact rendition per format' });
});
export const hostingBriefSchema = z.object({
  schemaVersion: z.literal(1), memo: z.string().trim().min(1).max(12000), decisionsCurrent: z.boolean(),
  initiativeKey: analysisKey.nullable(), campaignKey: analysisKey.nullable(), productKey: analysisKey,
  channel: z.enum(['meta', 'linkedin']).nullable(),
  hypothesis: text.nullable(), audienceKey: analysisKey.nullable(), audienceDefinition: text.nullable(),
  offer: text.nullable(), primaryOutcome: analysisKey.nullable(),
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(30),
  destination: destination.nullable(),
  budget: z.object({ currency: z.enum(['CAD', 'USD', 'EUR', 'GBP']),
    amountMinor: z.number().int().positive().max(1_000_000_000), type: z.enum(['daily', 'lifetime']),
    ceilingMinor: z.number().int().positive().max(1_000_000_000).nullable(),
  }).strict().nullable(),
  timezone: z.string().refine(s => { try { new Intl.DateTimeFormat('en', { timeZone: s }); return true; } catch { return false; } }, 'Use an IANA timezone').nullable(),
  startsAt: instant.nullable(), spendEndsAt: instant.nullable(), analyzeAfter: instant.nullable(),
  requiredFormats: z.array(renditionSchema.shape.format).min(1).max(4),
  experiment: z.object({
    kind: z.enum(['creative_comparison', 'landing_page']),
    allocation: z.enum(['platform_optimized', 'randomized_router', 'native_experiment']),
    arms: z.array(z.object({ key: analysisKey, destination: destination.nullable(), weight: z.number().int().positive().max(100) }).strict()).min(1).max(10),
    assignmentEvidenceRef: text.nullable(),
  }).strict().nullable(),
  ads: z.array(hostingAdSchema).max(50),
}).strict().superRefine((b, c) => {
  if (new Set(b.ads.map(a => a.key)).size !== b.ads.length) c.addIssue({ code: 'custom', message: 'Ad keys must be unique, including exclusions' });
  if (new Set(b.requiredFormats).size !== b.requiredFormats.length) c.addIssue({ code: 'custom', message: 'Required formats must be unique' });
  if (b.budget?.ceilingMinor && b.budget.amountMinor > b.budget.ceilingMinor) c.addIssue({ code: 'custom', message: 'Budget amount exceeds ceiling' });
  if (b.startsAt && b.spendEndsAt && Date.parse(b.startsAt) >= Date.parse(b.spendEndsAt)) c.addIssue({ code: 'custom', message: 'Start must precede spending end' });
  if (b.spendEndsAt && b.analyzeAfter && Date.parse(b.spendEndsAt) > Date.parse(b.analyzeAfter)) c.addIssue({ code: 'custom', message: 'Analysis must follow spending end' });
  const e = b.experiment;
  if (e && new Set(e.arms.map(a => a.key)).size !== e.arms.length) c.addIssue({ code: 'custom', message: 'Experiment arm keys must be unique' });
  if (e && e.arms.reduce((n, a) => n + a.weight, 0) !== 100) c.addIssue({ code: 'custom', message: 'Experiment allocation weights must sum to 100' });
});
export type HostingBrief = z.infer<typeof hostingBriefSchema>;
export type HostingAd = z.infer<typeof hostingAdSchema>;

/** Incomplete is valid: the conversation resolves nulls rather than inventing business decisions. */
export function emptyHostingBrief(memo = 'Describe the market test here.'): HostingBrief {
  return { schemaVersion: 1, memo, decisionsCurrent: false, initiativeKey: null, campaignKey: null, productKey: 'yoke', channel: null,
    hypothesis: null, audienceKey: null, audienceDefinition: null, offer: null, primaryOutcome: null, countries: [], destination: null,
    budget: null, timezone: null, startsAt: null, spendEndsAt: null, analyzeAfter: null,
    requiredFormats: ['feed45', 'vertical'], experiment: null, ads: [] };
}
