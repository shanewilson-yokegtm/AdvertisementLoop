// Slack review threads for Ad Studio.
// Outbound: share an exact version to a channel the user picks (bot must be in it). Save and post are separate.
// Inbound: Slack Events API -> replies in that thread become comments pinned to the shared version, exactly once.
// Identity: Slack user -> email reported by Slack -> organization member. Display names are never trusted.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type SlackApi = (method: string, args: Record<string, any>) => Promise<any>;
/** Raw upload of file bytes to the URL Slack returns from files.getUploadURLExternal. */
export type SlackUploader = (url: string, bytes: Uint8Array, filename: string) => Promise<boolean>;
export const slackUploader: SlackUploader = async (url, bytes, filename) => {
  const form = new FormData(); form.set('file', new Blob([bytes as any]), filename);
  const r = await fetch(url, { method: 'POST', body: form });
  return r.ok;
};
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Upload the real video into the channel as the review post, so it plays in Slack. Returns the post's ts (thread root). */
async function postVideo(db: SupabaseClient, slack: SlackApi, upload: SlackUploader, channel: string, path: string, filename: string, title: string, comment: string)
  : Promise<{ ts?: string; reason?: string }> {
  const { data: blob, error } = await db.storage.from('ad-assets').download(path);
  if (error || !blob) return { reason: 'could not read the video file' };
  if (blob.size > MAX_VIDEO_BYTES) return { reason: 'video is larger than 200 MB' };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const u = await slack('files.getUploadURLExternal', { filename, length: bytes.length });
  if (!u?.ok) return { reason: u?.error === 'missing_scope' ? 'missing_scope' : `Slack: ${u?.error || 'upload refused'}` };
  if (!(await upload(u.upload_url, bytes, filename))) return { reason: 'upload to Slack failed' };
  const c = await slack('files.completeUploadExternal', { files: [{ id: u.file_id, title }], channel_id: channel, initial_comment: comment });
  if (!c?.ok) return { reason: c?.error === 'missing_scope' ? 'missing_scope' : `Slack: ${c?.error || 'could not post the video'}` };
  // Slack shares the file asynchronously; the share's ts is the thread replies attach to.
  for (let i = 0; i < 10; i++) {
    const info = await slack('files.info', { file: u.file_id });
    if (info?.ok === false && info.error === 'missing_scope') return { reason: 'missing_scope' };
    const sh = info?.file?.shares || {};
    const ts = sh.private?.[channel]?.[0]?.ts || sh.public?.[channel]?.[0]?.ts;
    if (ts) return { ts };
    await sleep(800);
  }
  return { reason: 'video posted but Slack did not return its thread in time' };
}
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
export async function shareVersion(db: SupabaseClient, slack: SlackApi, actor: { user_id: string; role: string; display_name: string }, input: ShareInput, appUrl: string, upload: SlackUploader = slackUploader) {
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
  // Videos are posted as the real file so they play in Slack; images and fallbacks use a message with a preview.
  let res: any = null; let note: string | null = null;
  if (v.content_type?.startsWith('video/') && v.file_path) {
    const ext = v.file_path.split('.').pop() || 'mp4';
    const slug = asset.concept_name.replace(/[^\w -]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'ad';
    const comment = `*<${link}|${asset.concept_name}>* · v${v.version}\nShared by ${actor.display_name}${post.question ? `\n> ${post.question.replace(/\n/g, '\n> ')}` : ''}\n_Reply in this thread. Replies are saved as feedback on this exact version in Ad Studio._`;
    const vr = await postVideo(db, slack, upload, input.channel_id, v.file_path, `${slug}-v${v.version}.${ext}`, `${asset.concept_name} · v${v.version}`, comment);
    if (vr.ts) res = { ok: true, channel: input.channel_id, ts: vr.ts };
    else note = vr.reason === 'missing_scope' ? 'Posted the poster, not the video: the Slack app needs the files:write and files:read permissions.' : `Posted the poster, not the video (${vr.reason}).`;
  }
  if (!res) res = await slack('chat.postMessage', { channel: input.channel_id, text, blocks, unfurl_links: false });
  if (!res?.ok) {
    const err = res?.error === 'not_in_channel' || res?.error === 'channel_not_found' ? 'The Yoke Slack app is not in that channel. Invite it first.' : `Slack: ${res?.error || 'error'}`;
    await db.from('slack_posts').update({ state: 'failed', error: err, attempts: (post.attempts || 0) + 1, updated_at: new Date().toISOString() }).eq('id', post.id);
    return { status: 502, body: { error: 'slack_failed', message: err, post_id: post.id } };
  }
  const pl = await slack('chat.getPermalink', { channel: res.channel, message_ts: res.ts });
  const upd = await db.from('slack_posts').update({ state: 'sent', ts: res.ts, channel_id: res.channel, permalink: pl?.permalink || null, error: null, attempts: (post.attempts || 0) + 1, updated_at: new Date().toISOString() }).eq('id', post.id).select('*').single();
  await db.from('shares').insert({ asset_id: asset.id, version_id: v.id, channel: input.channel_id, note: post.question, link: pl?.permalink || link, shared_by: actor.user_id });
  return { status: 200, body: { ...upd.data, video: !note && !!v.content_type?.startsWith('video/'), note } };
}

/** Handle one verified Events API payload. Returns a short outcome string (also logged per event id). */
export async function handleSlackEvent(db: SupabaseClient, slack: SlackApi, payload: any, appUrl: string): Promise<string> {
  if (payload?.type !== 'event_callback' || !payload.event_id) return 'ignored';
  const seen = await db.from('slack_events').insert({ event_id: payload.event_id, type: payload.event?.type || null, outcome: 'processing' });
  if (seen.error) {
    if (seen.error.code !== '23505') throw new Error('Could not record the Slack event');
    const prior = await db.from('slack_events').select('outcome, received_at').eq('event_id', payload.event_id).single();
    if (prior.error || !prior.data) throw new Error('Could not read the Slack event');
    const stale = prior.data.outcome === 'processing' && Date.now() - new Date(prior.data.received_at).getTime() > 60_000;
    if (!String(prior.data.outcome).startsWith('error:') && !stale)
      return prior.data.outcome === 'processing' ? 'event_busy' : 'duplicate_event';
    // Reclaim a failed or abandoned delivery, without letting two retries process it together.
    const receivedAt = prior.data.received_at instanceof Date ? prior.data.received_at.toISOString() : prior.data.received_at;
    const claim = await db.from('slack_events').update({ outcome: 'processing', received_at: new Date().toISOString() })
      .eq('event_id', payload.event_id).eq('outcome', prior.data.outcome).eq('received_at', receivedAt).select('event_id');
    if (claim.error) throw new Error('Could not resume the Slack event');
    if (!claim.data?.length) return 'event_busy';
  }
  const outcome = await route(db, slack, payload, appUrl).catch(e => 'error: ' + String(e?.message || e).slice(0, 200));
  const saved = await db.from('slack_events').update({ outcome }).eq('event_id', payload.event_id);
  if (saved.error) throw new Error('Could not save the Slack event outcome');
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
