import { previousRange, validateRange, dateInZone, safeMediaUrl, type CreativeImage, type PerformanceData, type Period, type Insight, type Campaign, type AdSet, type Ad } from '../performance/model';

type Config = { token: string; accountId: string; version: string };
export class MetaReportingError extends Error {
  constructor(public code: string, message: string, public status = 502) { super(message); }
}
const GRAPH = 'https://graph.facebook.com';
const fields = 'date_start,date_stop,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,inline_link_clicks,actions';
/** The client has no mutation method. Pagination reconstructs the original request with a cursor:
 * provider next URLs and access_token query strings are never followed or logged. */
export function graphReader(config: Config, fetcher: typeof fetch = fetch) {
  if (!/^\d+$/.test(config.accountId) || !/^v\d+\.\d+$/.test(config.version)) throw new MetaReportingError('configuration', 'Reporting account or API version is invalid.', 503);
  async function get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${GRAPH}/${config.version}/${path}`);
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
    let response: Response;
    try { response = await fetcher(url, { method: 'GET', headers: { Authorization: `Bearer ${config.token}` }, cache: 'no-store', signal: AbortSignal.timeout(25_000) }); }
    catch { throw new MetaReportingError('network', 'Meta did not respond. Try refreshing in a moment.'); }
    let body: any; try { body = await response.json(); } catch { throw new MetaReportingError('response', 'Meta returned an unreadable response.'); }
    if (!response.ok || body.error) {
      const code = body.error?.code;
      // Provider messages can echo URLs or credentials. Return only controlled text.
      if (code === 190) throw new MetaReportingError('token_expired', 'The Meta reporting credential has expired or was revoked. Reconnect the reporting account.', 503);
      if ([4, 17, 32, 613].includes(code) || response.status === 429) throw new MetaReportingError('rate_limited', 'Meta’s reporting limit was reached. Wait a few minutes before refreshing.', 429);
      if ([10, 200, 294].includes(code) || response.status === 403) throw new MetaReportingError('permission', 'The reporting credential cannot read this data. Check this app’s account assignment and ads_read permission.', 503);
      throw new MetaReportingError('provider', 'Meta could not return this report. Check the account, API version and requested reporting fields.');
    }
    return body as T;
  }
  async function pages<T>(path: string, query: Record<string, string> = {}): Promise<T[]> {
    const output: T[] = []; const seen = new Set<string>(); let after = '';
    for (let page = 0; page < 50; page++) {
      const body = await get<{ data: T[]; paging?: { next?: string; cursors?: { after?: string } } }>(path, { ...query, limit: '500', ...(after ? { after } : {}) });
      if (!Array.isArray(body.data)) throw new MetaReportingError('response', 'Meta returned an incomplete collection.');
      output.push(...body.data);
      if (!body.paging?.next) return output;
      const cursor = body.paging.cursors?.after;
      if (!cursor || seen.has(cursor)) throw new MetaReportingError('incomplete', 'Meta pagination could not be completed. No partial totals are shown.');
      seen.add(cursor); after = cursor;
    }
    throw new MetaReportingError('too_large', 'This report exceeds the interactive reporting limit. Choose a shorter period.');
  }
  return { get, pages };
}

/** Placement-adapted creatives often expose only a 64px thumbnail. Resolve their
 * declared hashes against this account's image library; never synthesize CDN URLs. */
export async function enrichCreativeImages(ads: Ad[], accountPath: string, graph: ReturnType<typeof graphReader>) {
  const hashes = [...new Set(ads.flatMap(a => [a.creative?.image_hash, ...(a.creative?.asset_feed_spec?.images || []).map(i=>i.hash)]).filter((h): h is string => !!h))];
  const chunks: string[][] = []; for (let i=0;i<hashes.length;i+=75) chunks.push(hashes.slice(i,i+75));
  const images = new Map<string,CreativeImage>();
  // Bounded concurrency and explicit hashes avoid a scan of the entire library.
  for (let i=0;i<chunks.length;i+=3) {
    const batches = await Promise.all(chunks.slice(i,i+3).map(batch=>graph.pages<CreativeImage>(`${accountPath}/adimages`,{fields:'hash,url,width,height',hashes:JSON.stringify(batch)})));
    for (const image of batches.flat()) if (safeMediaUrl(image.url)) images.set(image.hash,image);
  }
  for (const ad of ads) {
    const c=ad.creative; if (!c) continue;
    const ordered=[c.image_hash,...(c.asset_feed_spec?.images||[]).map(i=>i.hash)].filter((h):h is string=>!!h);
    c.images=[...new Set(ordered)].map(h=>images.get(h)).filter((i):i is CreativeImage=>!!i);
    if (!c.image_url && c.images.length) c.image_url=c.images[0].url;
    c.body ||= c.asset_feed_spec?.bodies?.[0]?.text;
    c.title ||= c.asset_feed_spec?.titles?.[0]?.text;
  }
}

export async function loadMetaPerformance(config: Config, range: Period, campaignId: string | null, fetcher: typeof fetch = fetch): Promise<PerformanceData> {
  if (campaignId && !/^\d+$/.test(campaignId)) throw new MetaReportingError('invalid', 'Invalid campaign filter.', 400);
  const graph = graphReader(config, fetcher); const accountPath = `act_${config.accountId}`;
  const account = await graph.get<PerformanceData['account']>(accountPath, { fields: 'id,name,currency,timezone_name' });
  try { validateRange(range, dateInZone(new Date(), account.timezone_name)); } catch (e) { throw new MetaReportingError('invalid', (e as Error).message, 400); }
  const before = previousRange(range);
  const insight = (period: Period, level: string, extra: Record<string, string> = {}) => graph.pages<Insight>(`${accountPath}/insights`, {
    fields, level, time_range: JSON.stringify({ since: period.from, until: period.to }),
    use_unified_attribution_setting: 'true', action_report_time: 'impression',
    ...(campaignId ? { filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: [campaignId] }]) } : {}), ...extra,
  });
  // All independent data starts together; optional metadata failures do not erase performance.
  const results = await Promise.allSettled([
    insight(range, 'ad'), insight(range, 'ad', { time_increment: '1' }), insight(range, 'account'),
    insight(range, 'campaign'), insight(before, 'account'),
    graph.pages<Campaign>(`${accountPath}/campaigns`, { fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time' }),
    graph.pages<AdSet>(`${accountPath}/adsets`, { fields: 'id,name,campaign_id,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,start_time,end_time,attribution_spec,targeting,promoted_object' }),
    graph.pages<Ad>(`${accountPath}/ads`, { fields: 'id,name,campaign_id,adset_id,effective_status,creative{id,thumbnail_url,image_url,image_hash,video_id,body,title,url_tags,object_story_spec,asset_feed_spec}' }),
    insight(range, 'account', { fields: 'date_start,date_stop,spend,impressions,inline_link_clicks', breakdowns: 'publisher_platform' }),
  ]);
  // Full-range ad metrics and provider account aggregate are required. A failed daily query
  // must not become a zero-filled trend; fail explicitly rather than fabricate dates.
  for (const i of [0, 1, 2, 3]) if (results[i].status === 'rejected') throw (results[i] as PromiseRejectedResult).reason;
  const warnings: string[] = [];
  const labels = ['ad results', 'daily results', 'account totals', 'campaign totals', 'previous-period comparison', 'campaign settings', 'ad-set settings', 'creative previews', 'platform breakdown'];
  results.forEach((r, i) => { if (r.status === 'rejected') warnings.push(`${labels[i]} unavailable. ${r.reason instanceof MetaReportingError ? r.reason.message : 'Try refreshing.'}`); });
  const value = <T>(i: number, fallback: T): T => results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<unknown>).value as T : fallback;
  const ads = value<Ad[]>(7, []);
  try { await enrichCreativeImages(ads,accountPath,graph); }
  catch { warnings.push('Full-resolution creative assets unavailable. Meta thumbnails are shown where available.'); }
  const knownIds = new Set(ads.map(a => a.id));
  for (const row of value<Insight[]>(0, [])) if (row.ad_id && !knownIds.has(row.ad_id)) { ads.push({ id: row.ad_id, name: row.ad_name || row.ad_id, campaign_id: row.campaign_id!, adset_id: row.adset_id! }); knownIds.add(row.ad_id); }
  return { account, range, previousRange: before, source: 'meta', campaignId, fetchedAt: new Date().toISOString(), warnings,
    current: value(0, []), daily: value(1, []), accountTotal: value<Insight[]>(2, [])[0] || null,
    campaignTotals: value(3, []), previous: results[4].status === 'fulfilled' ? value<Insight[]>(4, [])[0] || { date_start: before.from, date_stop: before.to } : null,
    campaigns: value(5, []), adsets: value(6, []), ads, platforms: value(8, []),
  };
}
