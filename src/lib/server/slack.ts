// Slack review threads for Ad Studio.
// Outbound: share an exact version to a channel the user picks (bot must be in it). Save and post are separate.
// Inbound: Slack Events API -> replies in that thread become comments pinned to the shared version, exactly once.
// Identity: Slack user -> email reported by Slack -> organization member. Display names are never trusted.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type SlackApi = (method: string, args: Record<string, any>) => Promise<any>;
export function slackApi(token: string, fetcher: typeof fetch = fetch): SlackApi {
  // Form-encoded for every method: Slack ignores JSON bodies on read methods (users.conversations, users.info,
  // chat.getPermalink, users.lookupByEmail), which silently drops arguments such as types=private_channel.
  return async (method, args) => {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== null) body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    const r = await fetcher(`https://slack.com/api/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body });
    return r.json();
  };
}

/** Slack request signing (v0). Rejects old timestamps (replay) and bad signatures. */
export function verifySlackSignature(raw: string, ts: string | null, sig: string | null, secret: string, now = Date.now()) {
  if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 60 * 5) return false;
  const mine = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex');
  const a = Buffer.from(mine), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "at 0:07", "1:02", "@ 12s" -> seconds. */
export function parseTimecode(text: string): number | null {
  const m = /(?:^|\s|@|at\s)(\d{1,2}):([0-5]\d)(?:\.(\d))?\b/i.exec(text);
  if (m) return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0);
  const s = /(?:^|\s)(?:@|at)\s?(\d{1,3}(?:\.\d)?)\s?s(?:ec)?\b/i.exec(text);
  return s ? Number(s[1]) : null;
}

const clean = (t: string) => t.replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)').replace(/<(https?:[^>]+)>/g, '$1').replace(/<@([A-Z0-9]+)>/g, '@$1').slice(0, 4000);

/** Verified Slack user -> member id (cached; re-checked daily). Non-members map to null. */
export async function memberForSlackUser(db: SupabaseClient, slack: SlackApi, userId: string, teamId?: string): Promise<string | null> {
  const { data: cached } = await db.from('slack_users').select('member_id, checked_at').eq('slack_user_id', userId).maybeSingle();
  if (cached && Date.now() - new Date(cached.checked_at).getTime() < 24 * 3600_000) return cached.member_id;
  const info = await slack('users.info', { user: userId });
  const email: string | null = info?.ok && !info.user?.is_bot && !info.user?.deleted ? (info.user?.profile?.email || '').toLowerCase() || null : null;
  let member: string | null = null;
  if (email) { const { data: m } = await db.from('members').select('user_id').eq('email', email).maybeSingle(); member = m?.user_id || null; }
  await db.from('slack_users').upsert({ slack_user_id: userId, team_id: teamId || null, member_id: member, email, checked_at: new Date().toISOString() });
  return member;
}

export type ShareInput = { asset_id: string; version_id: string; channel_id: string; question?: string | null; idempotency_key: string };

/** Post one exact version. Retrying with the same idempotency key never posts twice once Slack accepted it. */
export async function shareVersion(db: SupabaseClient, slack: SlackApi, actor: { user_id: string; role: string; display_name: string }, input: ShareInput, appUrl: string) {
  const { data: asset } = await db.from('assets').select('id, concept_name, owner_id, kind, format').eq('id', input.asset_id).maybeSingle();
  if (!asset) return { status: 404, body: { error: 'not_found' } };
  if (!(actor.role === 'admin' || (asset.owner_id === actor.user_id && actor.role !== 'viewer'))) return { status: 403, body: { error: 'forbidden', message: 'Only the owner or an admin can share this ad. You can leave a comment instead.' } };
  const { data: v } = await db.from('versions').select('id, version, poster_path, file_path, content_type').eq('id', input.version_id).eq('asset_id', asset.id).maybeSingle();
  if (!v) return { status: 404, body: { error: 'not_found', message: 'Version not found on this ad' } };
  if (!/^[CG][A-Z0-9]{6,}$/.test(input.channel_id)) return { status: 400, body: { error: 'invalid', message: 'Pick a channel from the list' } };

  const key = String(input.idempotency_key || '').slice(0, 120);
  if (!key) return { status: 400, body: { error: 'invalid', message: 'idempotency_key required' } };
  let { data: post } = await db.from('slack_posts').select('*').eq('idempotency_key', key).maybeSingle();
  if (post?.state === 'sent') return { status: 200, body: { ...post, duplicate: true } };
  if (!post) {
    const ins = await db.from('slack_posts').insert({ asset_id: asset.id, version_id: v.id, channel_id: input.channel_id, question: input.question?.trim() || null, posted_by: actor.user_id, idempotency_key: key }).select('*').single();
    if (ins.error) { const again = await db.from('slack_posts').select('*').eq('idempotency_key', key).maybeSingle(); post = again.data; } else post = ins.data;
  }
  if (!post) return { status: 500, body: { error: 'error' } };

  const link = `${appUrl}/a/${asset.id}?v=${v.id}`;
  const previewPath = v.poster_path || (v.content_type?.startsWith('image/') ? v.file_path : null);
  let preview: string | null = null;
  if (previewPath) { const { data } = await db.storage.from('ad-assets').createSignedUrl(previewPath, 7 * 24 * 3600); preview = data?.signedUrl || null; }
  const text = `${asset.concept_name} · v${v.version} for review`;
  const blocks: any[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `*<${link}|${asset.concept_name}>* · v${v.version}\nShared by ${actor.display_name}${post.question ? `\n> ${post.question.replace(/\n/g, '\n> ')}` : ''}` } },
    ...(preview ? [{ type: 'image', image_url: preview, alt_text: `${asset.concept_name} v${v.version}` }] : []),
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'Reply in this thread. Replies are saved as feedback on this exact version in Ad Studio.' }] },
  ];
  const res = await slack('chat.postMessage', { channel: input.channel_id, text, blocks, unfurl_links: false });
  if (!res?.ok) {
    const err = res?.error === 'not_in_channel' || res?.error === 'channel_not_found' ? 'The Yoke Slack app is not in that channel. Invite it first.' : `Slack: ${res?.error || 'error'}`;
    await db.from('slack_posts').update({ state: 'failed', error: err, attempts: (post.attempts || 0) + 1, updated_at: new Date().toISOString() }).eq('id', post.id);
    return { status: 502, body: { error: 'slack_failed', message: err, post_id: post.id } };
  }
  const pl = await slack('chat.getPermalink', { channel: res.channel, message_ts: res.ts });
  const upd = await db.from('slack_posts').update({ state: 'sent', ts: res.ts, channel_id: res.channel, permalink: pl?.permalink || null, error: null, attempts: (post.attempts || 0) + 1, updated_at: new Date().toISOString() }).eq('id', post.id).select('*').single();
  await db.from('shares').insert({ asset_id: asset.id, version_id: v.id, channel: input.channel_id, note: post.question, link: pl?.permalink || link, shared_by: actor.user_id });
  return { status: 200, body: upd.data };
}

/** Handle one verified Events API payload. Returns a short outcome string (also logged per event id). */
export async function handleSlackEvent(db: SupabaseClient, slack: SlackApi, payload: any, appUrl: string): Promise<string> {
  if (payload?.type !== 'event_callback' || !payload.event_id) return 'ignored';
  const seen = await db.from('slack_events').insert({ event_id: payload.event_id, type: payload.event?.type || null, outcome: 'processing' });
  if (seen.error) return 'duplicate_event';
  const outcome = await route(db, slack, payload, appUrl).catch(e => 'error: ' + String(e?.message || e).slice(0, 200));
  await db.from('slack_events').update({ outcome }).eq('event_id', payload.event_id);
  return outcome;
}

async function postFor(db: SupabaseClient, channel: string, threadTs: string) {
  const { data } = await db.from('slack_posts').select('id, asset_id, version_id, ts, permalink').eq('channel_id', channel).eq('ts', threadTs).eq('state', 'sent').maybeSingle();
  return data;
}

async function route(db: SupabaseClient, slack: SlackApi, payload: any, appUrl: string): Promise<string> {
  const e = payload.event || {};
  if (e.type === 'message') {
    if (e.subtype === 'message_changed') {
      const m = e.message || {}; const ref = `${e.channel}:${m.ts}`;
      const { data: c } = await db.from('comments').select('id, body, body_history').eq('source_ref', ref).maybeSingle();
      if (!c) return 'edit_ignored';
      const body = clean(m.text || '');
      if (body === c.body) return 'edit_same';
      await db.from('comments').update({ body: body || c.body, edited_at: new Date().toISOString(), body_history: [...(c.body_history || []), { body: c.body, replaced_at: new Date().toISOString() }] }).eq('id', c.id);
      return 'edited';
    }
    if (e.subtype === 'message_deleted') {
      const ref = `${e.channel}:${e.deleted_ts || e.previous_message?.ts}`;
      const { data: c } = await db.from('comments').select('id').eq('source_ref', ref).maybeSingle();
      if (!c) return 'delete_ignored';
      await db.from('comments').update({ deleted_at: new Date().toISOString() }).eq('id', c.id);   // text kept for review history
      return 'deleted';
    }
    if (e.subtype || e.bot_id || !e.thread_ts || e.thread_ts === e.ts) return 'not_a_reply';
    const post = await postFor(db, e.channel, e.thread_ts);
    if (!post) return 'not_a_review_thread';
    const member = await memberForSlackUser(db, slack, e.user, payload.team_id);
    if (!member) return 'ignored_non_member';
    const body = clean(e.text || '').trim();
    if (!body) return 'empty';
    const pl = await slack('chat.getPermalink', { channel: e.channel, message_ts: e.ts }).catch(() => null);
    const before = await pendingCount(db, post.asset_id);
    const ins = await db.from('comments').insert({ asset_id: post.asset_id, version_id: post.version_id, author: member, body, at_sec: parseTimecode(body),
      source: 'slack', source_ref: `${e.channel}:${e.ts}`, source_link: pl?.permalink || post.permalink || null });
    if (ins.error) return ins.error.code === '23505' ? 'duplicate_message' : 'error: ' + ins.error.message;
    if (before === 0) await notifyOwner(db, slack, post.asset_id, post.version_id, appUrl, member);
    return 'comment_saved';
  }
  if (e.type === 'reaction_added' || e.type === 'reaction_removed') {
    const item = e.item || {}; if (item.type !== 'message') return 'ignored';
    let post = await postFor(db, item.channel, item.ts);
    if (!post) {
      const { data: c } = await db.from('comments').select('asset_id, version_id').eq('source_ref', `${item.channel}:${item.ts}`).maybeSingle();
      if (!c) return 'not_a_review_thread';
      post = { id: '', asset_id: c.asset_id, version_id: c.version_id, ts: item.ts, permalink: null };
    }
    const member = await memberForSlackUser(db, slack, e.user, payload.team_id);
    if (e.type === 'reaction_added') {
      await db.from('slack_reactions').upsert({ channel_id: item.channel, message_ts: item.ts, slack_user_id: e.user, reaction: e.reaction, member_id: member, asset_id: post.asset_id, version_id: post.version_id, removed_at: null });
      return 'reaction_saved';
    }
    await db.from('slack_reactions').update({ removed_at: new Date().toISOString() }).match({ channel_id: item.channel, message_ts: item.ts, slack_user_id: e.user, reaction: e.reaction });
    return 'reaction_removed';
  }
  return 'ignored';
}

async function pendingCount(db: SupabaseClient, assetId: string) {
  const { count } = await db.from('comments').select('id', { count: 'exact', head: true }).eq('asset_id', assetId).eq('status', 'open');
  return count || 0;
}

/** Default notification: DM the owner once when their ad goes from no feedback to some. Never DMs the commenter about their own ad. */
async function notifyOwner(db: SupabaseClient, slack: SlackApi, assetId: string, versionId: string, appUrl: string, commenter: string) {
  const { data: a } = await db.from('assets').select('concept_name, owner_id').eq('id', assetId).maybeSingle();
  if (!a?.owner_id || a.owner_id === commenter) return;
  const { data: m } = await db.from('members').select('email').eq('user_id', a.owner_id).maybeSingle();
  if (!m?.email) return;
  const u = await slack('users.lookupByEmail', { email: m.email }).catch(() => null);
  if (!u?.ok) return;
  await slack('chat.postMessage', { channel: u.user.id, text: `Feedback to process on *${a.concept_name}*: ${appUrl}/a/${assetId}?v=${versionId}`, unfurl_links: false });
}
