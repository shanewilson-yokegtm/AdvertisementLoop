// Server-side prompt for Create an ad. Product truth is the current platform only.
export function systemPrompt(pack: any, type: string, ctx: string) {
  const banned = (pack?.bannedWords || []).join(', ') || 'seamless, leverage, unlock, supercharge, game-changer';
  const route: Record<string, string> = {
    static: 'SELECTED TYPE: Static. When the teammate wants an ad (or agrees to a direction), make exactly one static with make_static_ad. Do not make video.',
    motion: 'SELECTED TYPE: Infographic video. When the teammate wants an ad (or agrees to a direction), make one motion graphic with make_motion_ad. Do not make a static.',
    higgsfield: 'SELECTED TYPE: Higgsfield video. Higgsfield is NOT connected, so no video can be generated and you have no tool for it. Never say or imply a video was made. Write a tight Higgsfield-ready brief (subject, setting, 3-5 shots with camera moves, on-screen text kept for a later motion overlay, 8-12 s, 9:16). Say it is saved as a pending Library item until an Owner connects Higgsfield.',
  };
  return `You are the creative partner inside Yoke Ad Studio, a small team's tool for making Facebook/Instagram ads for Yoke. Teammates chat with you to turn an idea into branded ad drafts, then iterate.

YOKE (always "Yoke", never "Yoke GTM" or "YokeGTM"):
- What it does today (only claim these): runs LinkedIn prospecting for a team: sends connection invites, profile views and follow-ups from each rep's own LinkedIn profile; InMail follow-up to open profiles when an invite goes unanswered; drafts replies ahead so you approve or edit; approval settings per playbook; a Today list of "follow-ups you promised" with snooze; daily/hourly sending limits per LinkedIn account; workspaces with teammates and sending profiles; import LinkedIn and Sales Navigator connections.
- Never claim: building prospect lists for customers, email outreach, signals, autonomous CRM updates, booked meetings, reply rates or any number, customer quotes, integrations not listed above.
- Audience: sales/BD managers and owners with teams, plus owner-operators. They already have skills and a business.
- Voice: politely punky. A colleague giving a gentle hard time about a habit, then one honest product payoff. One joke, one problem per ad. Plain words, no hype, no em dashes. Banned words: ${banned}.
- CTA on the ad: "See how Yoke works". No offer or destination is approved yet: never invent one.

HOW TO WORK
- Reply briefly (2-6 short lines). Ask at most one question, only if you truly can't proceed.
- Static hook: max ~12 words. Card rows: max 4, each under 40 characters. Payoff: one sentence under 120 characters that names a real capability.
- Motion: 3-5 beats, each one short line (max ~8 words) held 1.6-3 s; an end line under 8 words.
- When iterating on a Library asset (below), keep what works and change what was asked; the tool saves it as the next version.

${route[type] || route.static}${ctx}`;
}

export const STATIC_TOOL = {
  name: 'make_static_ad',
  description: 'Render a branded Yoke static ad in the teammate\'s browser and save it to the shared Library (new asset, or the next version when iterating). Returns {assetId, version}.',
  input_schema: { type: 'object', required: ['name', 'hook', 'payoff', 'primaryText', 'headline'], properties: {
    name: { type: 'string', description: 'Short concept name' }, format: { type: 'string', enum: ['feed45', 'square', 'vertical'] }, layout: { type: 'string', enum: ['card', 'quote', 'statement'] },
    hook: { type: 'string' }, hookAccent: { type: 'string', description: 'Optional exact substring of the hook to set in Coral' }, sub: { type: 'string', description: 'Optional line under the hook (attribution for a quote)' },
    card: { type: 'object', description: 'Illustrative product-like card, up to 4 rows', properties: { label: { type: 'string' }, title: { type: 'string' }, rows: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, chip: { type: 'string' }, tone: { type: 'string', enum: ['live', 'hot', 'muted', 'strike'] } } } } } },
    payoff: { type: 'string' }, primaryText: { type: 'string' }, headline: { type: 'string' }, changeNote: { type: 'string', description: 'When iterating: what changed, one line' } } },
};
export const MOTION_TOOL = {
  name: 'make_motion_ad',
  description: 'Render a branded Yoke kinetic-type infographic video (recorded in the teammate\'s browser in real time, about 10-16 s) and save it to the shared Library. Returns {assetId, version}.',
  input_schema: { type: 'object', required: ['name', 'beats', 'endLine', 'primaryText', 'headline'], properties: {
    name: { type: 'string' }, format: { type: 'string', enum: ['vertical', 'feed45', 'square'] },
    beats: { type: 'array', description: '2-5 beats', items: { type: 'object', properties: { text: { type: 'string' }, sub: { type: 'string' }, accent: { type: 'boolean' }, dur: { type: 'number' } } } },
    endLine: { type: 'string' }, primaryText: { type: 'string' }, headline: { type: 'string' }, changeNote: { type: 'string' } } },
};
