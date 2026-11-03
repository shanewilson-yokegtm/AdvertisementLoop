/** Account reporting contract. Meta actions are attributed events, never verified CRM people. */
export type ResultKey = 'view_content' | 'lead' | 'start_trial' | 'purchase';
export const RESULT_LABELS: Record<ResultKey, string> = { view_content: 'View content', lead: 'Leads', start_trial: 'Start trial', purchase: 'Purchases' };
const ALIASES: Record<ResultKey, string[]> = {
  view_content: ['offsite_conversion.fb_pixel_view_content', 'view_content'],
  lead: ['offsite_conversion.fb_pixel_lead', 'lead'],
  start_trial: ['offsite_conversion.fb_pixel_start_trial', 'start_trial'],
  purchase: ['offsite_conversion.fb_pixel_purchase', 'purchase'],
};
export type Actions = { action_type: string; value: string }[];
export type Insight = { ad_id?: string; ad_name?: string; adset_id?: string; adset_name?: string; campaign_id?: string; campaign_name?: string; date_start: string; date_stop: string; spend?: string; impressions?: string; reach?: string; inline_link_clicks?: string; actions?: Actions; publisher_platform?: string };
export type Campaign = { id: string; name: string; status?: string; effective_status?: string; objective?: string; daily_budget?: string; lifetime_budget?: string; start_time?: string; stop_time?: string };
export type AdSet = { id: string; name: string; campaign_id: string; effective_status?: string; daily_budget?: string; lifetime_budget?: string; optimization_goal?: string; billing_event?: string; start_time?: string; end_time?: string; attribution_spec?: { event_type: string; window_days: number }[]; targeting?: Record<string, unknown>; promoted_object?: Record<string, unknown> };
export type CreativeImage = { hash: string; url: string; width?: number; height?: number };
export type Creative = { id: string; thumbnail_url?: string; image_url?: string; image_hash?: string; video_id?: string; body?: string; title?: string; url_tags?: string; images?: CreativeImage[]; asset_feed_spec?: { images?: { hash?: string; url?: string }[]; bodies?: { text?: string }[]; titles?: { text?: string }[]; link_urls?: { website_url?: string }[]; videos?: { video_id?: string }[] }; object_story_spec?: { link_data?: { link?: string; message?: string; name?: string; picture?: string }; video_data?: { message?: string; title?: string } } };
export type Ad = { id: string; name: string; campaign_id: string; adset_id: string; effective_status?: string; creative?: Creative };
export type Metrics = { spend: number; impressions: number; clicks: number; results: number; reach: number | null };
export type Period = { from: string; to: string };
export type PerformanceData = {
  account: { id: string; name: string; currency: string; timezone_name: string };
  range: Period; previousRange: Period; fetchedAt: string; warnings: string[];
  campaigns: Campaign[]; adsets: AdSet[]; ads: Ad[];
  current: Insight[]; daily: Insight[]; accountTotal: Insight | null;
  campaignTotals: Insight[]; previous: Insight | null; platforms: Insight[];
  campaignId: string | null; source: 'meta' | 'demo';
};
export function numeric(value: unknown): number { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? n : 0; }
export function resultCount(actions: Actions | undefined, key: ResultKey): number {
  // Aliases overlap. Prefer the specific website event; never add aggregate aliases to it.
  const type = ALIASES[key].find(alias => actions?.some(a => a.action_type === alias));
  return numeric(actions?.find(a => a.action_type === type)?.value);
}
export function metrics(rows: Insight[], key: ResultKey, uniqueReach: number | null = null): Metrics {
  return rows.reduce((a, r) => ({ spend: a.spend + numeric(r.spend), impressions: a.impressions + numeric(r.impressions), clicks: a.clicks + numeric(r.inline_link_clicks), results: a.results + resultCount(r.actions, key), reach: uniqueReach }), { spend: 0, impressions: 0, clicks: 0, results: 0, reach: uniqueReach });
}
export function ratio(n: number, d: number) { return d > 0 ? n / d : null; }
export function change(current: number, previous: number): number | null { return previous > 0 ? (current - previous) / previous * 100 : null; }
export function conceptOf(name: string): string | null { const bits = name.split('|').map(s => s.trim()); return bits.length >= 3 && bits[1] ? bits[1] : null; }
export function dateInZone(now = new Date(), zone = 'America/Vancouver') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const p = (type: string) => parts.find(x => x.type === type)?.value;
  return `${p('year')}-${p('month')}-${p('day')}`;
}
export function shiftDay(date: string, days: number) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function validDate(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s; }
export function dayCount(p: Period) { return Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1; }
export function validateRange(p: Period, today: string) {
  if (!validDate(p.from) || !validDate(p.to) || p.from > p.to || p.to > today || dayCount(p) > 93) throw new Error('Choose valid dates, up to 93 days, ending no later than today in the account timezone.');
  return p;
}
export function previousRange(p: Period): Period { return { from: shiftDay(p.from, -dayCount(p)), to: shiftDay(p.from, -1) }; }
export function presetRange(preset: string, today: string): Period {
  if (preset === 'today') return { from: today, to: today };
  const to = shiftDay(today, -1);
  if (preset === 'mtd') return { from: today.slice(0, 8) + '01', to: today.endsWith('-01') ? today : to };
  return { from: shiftDay(to, -(Number(preset) || 30) + 1), to };
}
export function dailySeries(data: PerformanceData, key: ResultKey) {
  const byDay = new Map<string, Insight[]>();
  for (const row of data.daily) byDay.set(row.date_start, [...(byDay.get(row.date_start) || []), row]);
  return Array.from({ length: dayCount(data.range) }, (_, i) => { const date = shiftDay(data.range.from, i); return { date, ...metrics(byDay.get(date) || [], key) }; });
}
export function safeMediaUrl(value?: string): string | undefined {
  if (!value) return; try { const u = new URL(value); if (u.protocol === 'https:' && (u.hostname.endsWith('.fbcdn.net') || u.hostname.endsWith('.cdninstagram.com') || u.hostname === 'scontent.xx.fbcdn.net' || u.hostname === 'www.facebook.com')) return value; } catch { /* no untrusted schemes */ }
}
export function destination(ad: Ad) { const raw = ad.creative?.object_story_spec?.link_data?.link || ad.creative?.asset_feed_spec?.link_urls?.[0]?.website_url; if (!raw) return null; try { const u = new URL(raw); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; } }
export function csvCell(value: unknown) { let s = String(value ?? ''); if (/^\s*[=+@-]|^[\t\r\n]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; }
export type GroupRow = { id: string; name: string; metrics: Metrics; adIds: string[]; status: string; thumbnail?: string; concept: string | null; campaignIds: string[]; creativeId?: string };
export function groups(data: PerformanceData, by: 'campaign' | 'adset' | 'concept' | 'creative', key: ResultKey): GroupRow[] {
  const adMap = new Map(data.ads.map(a => [a.id, a])); const rows = new Map<string, GroupRow>();
  for (const row of data.current) {
    const ad = adMap.get(row.ad_id || ''); const name = ad?.name || row.ad_name || 'Unnamed ad'; const concept = conceptOf(name);
    const id = by === 'campaign' ? row.campaign_id! : by === 'adset' ? row.adset_id! : by === 'concept' ? concept || '__unclassified' : ad?.creative?.id || row.ad_id!;
    if (!id) continue;
    const label = by === 'campaign' ? data.campaigns.find(c => c.id === id)?.name || row.campaign_name || id : by === 'adset' ? data.adsets.find(s => s.id === id)?.name || row.adset_name || id : by === 'concept' ? concept || 'Unclassified' : name;
    let item = rows.get(id);
    if (!item) { item = { id, name: label, metrics: metrics([], key), adIds: [], status: by === 'campaign' ? data.campaigns.find(c => c.id === id)?.effective_status || 'UNKNOWN' : by === 'adset' ? data.adsets.find(s => s.id === id)?.effective_status || 'UNKNOWN' : ad?.effective_status || 'UNKNOWN', thumbnail: safeMediaUrl(ad?.creative?.image_url || ad?.creative?.thumbnail_url), concept, campaignIds: [], creativeId: ad?.creative?.id }; rows.set(id, item); }
    const m = metrics([row], key); item.metrics.spend += m.spend; item.metrics.impressions += m.impressions; item.metrics.clicks += m.clicks; item.metrics.results += m.results;
    if (row.ad_id && !item.adIds.includes(row.ad_id)) item.adIds.push(row.ad_id);
    if (row.campaign_id && !item.campaignIds.includes(row.campaign_id)) item.campaignIds.push(row.campaign_id);
  }
  if (by === 'campaign') for (const c of data.campaigns.filter(c => !data.campaignId || c.id === data.campaignId)) if (!rows.has(c.id)) rows.set(c.id, { id: c.id, name: c.name, metrics: metrics([], key), adIds: [], status: c.effective_status || 'UNKNOWN', concept: null, campaignIds: [c.id] });
  if (by === 'adset') for (const s of data.adsets.filter(s => !data.campaignId || s.campaign_id === data.campaignId)) if (!rows.has(s.id)) rows.set(s.id, { id: s.id, name: s.name, metrics: metrics([], key), adIds: [], status: s.effective_status || 'UNKNOWN', concept: null, campaignIds: [s.campaign_id] });
  for (const ad of data.ads.filter(a => !data.campaignId || a.campaign_id === data.campaignId)) {
    const concept = conceptOf(ad.name); const id = by === 'campaign' ? ad.campaign_id : by === 'adset' ? ad.adset_id : by === 'concept' ? concept || '__unclassified' : '';
    if (by === 'concept' && !rows.has(id)) rows.set(id, { id, name: concept || 'Unclassified', metrics: metrics([], key), adIds: [], status: ad.effective_status || 'UNKNOWN', concept, campaignIds: [] });
    const item = rows.get(id); if (!item) continue;
    if (!item.adIds.includes(ad.id)) item.adIds.push(ad.id);
    if (!item.campaignIds.includes(ad.campaign_id)) item.campaignIds.push(ad.campaign_id);
  }
  // Inventory stays inspectable even when it had no delivery in this period.
  if (by === 'creative') for (const ad of data.ads.filter(a => !data.campaignId || a.campaign_id === data.campaignId)) {
    const id = ad.creative?.id || ad.id;
    let item = rows.get(id);
    if (!item) { item = { id, name: ad.name, metrics: metrics([], key), adIds: [], status: ad.effective_status || 'UNKNOWN', thumbnail: safeMediaUrl(ad.creative?.image_url || ad.creative?.thumbnail_url), concept: conceptOf(ad.name), campaignIds: [], creativeId: ad.creative?.id }; rows.set(id, item); }
    if (!item.adIds.includes(ad.id)) item.adIds.push(ad.id);
    if (!item.campaignIds.includes(ad.campaign_id)) item.campaignIds.push(ad.campaign_id);
  }
  if (by === 'concept' || by === 'creative') for (const item of rows.values()) {
    const states = new Set(item.adIds.map(id => adMap.get(id)?.effective_status || 'UNKNOWN'));
    item.status = states.size > 1 ? 'MIXED' : [...states][0] || 'UNKNOWN';
  }
  // Only a provider aggregate at this exact grain can supply deduplicated reach.
  if (by === 'campaign') for (const r of rows.values()) { const total = data.campaignTotals.find(t => t.campaign_id === r.id); r.metrics.reach = total?.reach == null ? null : numeric(total.reach); }
  return [...rows.values()].sort((a, b) => b.metrics.spend - a.metrics.spend);
}
