// Ad Studio API for each member's own Claude (and other scripts they run as themselves).
// Auth: "Authorization: Bearer yas_..." personal token -> member, resolved server-side.
// Every write goes through the same database functions/rules as the app, acting as that member (p_actor).
// The service key never leaves the server and never widens what the member may do.
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { shareVersion, slackApi } from './slack';

export type Actor = { user_id: string; role: 'viewer' | 'creator' | 'approver' | 'admin'; email: string; display_name: string };
export class ApiError extends Error { constructor(public status: number, public code: string, msg: string) { super(msg); } }

const RANK = ['none', 'viewer', 'creator', 'approver', 'admin'];
export const atLeast = (a: Actor, r: string) => RANK.indexOf(a.role) >= RANK.indexOf(r);
export const MEDIA_TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'application/json': 'json', 'application/zip': 'zip', 'image/svg+xml': 'svg', 'text/html': 'html', 'text/plain': 'txt',
};
// Editable sources (zip, svg, html, json, txt) are stored next to the media; the bucket must allow them.
export const SOURCE_TYPES = new Set(['application/json', 'application/zip', 'image/svg+xml', 'text/html', 'text/plain']);

export function hashToken(t: string) { return createHash('sha256').update(t, 'utf8').digest('hex'); }

export async function authenticate(db: SupabaseClient, header: string | null): Promise<Actor> {
  const m = /^Bearer\s+(yas_[a-f0-9]{64})\s*$/i.exec(header || '');
  if (!m) throw new ApiError(401, 'unauthenticated', 'Send your personal Ad Studio token as "Authorization: Bearer yas_..."');
  const { data, error } = await db.rpc('api_token_resolve', { p_hash: hashToken(m[1]) });
  if (error) throw new ApiError(500, 'auth_unavailable', 'Could not verify the token');
  const a = (data as Actor[] | null)?.[0];
  if (!a) throw new ApiError(401, 'invalid_token', 'Token not recognised or revoked');
  return a;
}

export function dbError(e: { message?: string; code?: string } | null): ApiError {
  const msg = e?.message || 'Database error';
  if (e?.code === '42501' || /row-level security|owner or an admin|admin only|not a member/i.test(msg)) return new ApiError(403, 'forbidden', msg);
  if (e?.code === '40001' || /^conflict|stale_parent/i.test(msg)) return new ApiError(409, 'conflict', msg);
  if (e?.code === 'P0002' || /not found/i.test(msg)) return new ApiError(404, 'not_found', msg);
  if (e?.code === '23505') return new ApiError(409, 'duplicate', msg);
  if (e?.code === '22023' || e?.code === 'P0001') return new ApiError(400, 'invalid', msg);
  return new ApiError(500, 'error', msg);
}

async function canManage(db: SupabaseClient, a: Actor, assetId: string) {
  if (a.role === 'admin') return true;
  if (!atLeast(a, 'creator')) return false;
  const { data } = await db.from('assets').select('owner_id').eq('id', assetId).maybeSingle();
  return !!data && data.owner_id === a.user_id;
}
export async function requireManage(db: SupabaseClient, a: Actor, assetId: string) {
  const { data } = await db.from('assets').select('id').eq('id', assetId).maybeSingle();
  if (!data) throw new ApiError(404, 'not_found', `Asset ${assetId} not found`);
  if (!(await canManage(db, a, assetId))) throw new ApiError(403, 'forbidden', 'Only the owner or an admin can change this ad. You can leave a comment instead.');
}
const ok = <T>(x: { data: T; error: any }) => { if (x.error) throw dbError(x.error); return x.data; };

/** Route a request. db must be a service-role client; every check below runs as `a`. */
export async function handle(db: SupabaseClient, a: Actor, method: string, parts: string[], body: any, query: URLSearchParams, appUrl: string) {
  const [r0, r1, r2] = parts;
  const link = (asset: string, version?: string) => `${appUrl}/a/${asset}${version ? `?v=${version}` : ''}`;
  if (!atLeast(a, 'viewer')) throw new ApiError(403, 'forbidden', 'Not a member');

  if (method === 'GET' && r0 === 'me') return { user_id: a.user_id, email: a.email, display_name: a.display_name, role: a.role };

  if (method === 'GET' && r0 === 'slack' && r1 === 'channels') {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new ApiError(503, 'slack_not_connected', 'Slack sharing is not switched on yet.');
    const r = await slackApi(token)('users.conversations', { types: 'public_channel,private_channel', exclude_archived: true, limit: 200 });
    return { channels: (r?.channels || []).map((c: any) => ({ id: c.id, name: c.name })) };
  }

  if (method === 'GET' && r0 === 'brand') {
    const { data } = await db.from('brand_pack').select('pack, updated_at').eq('id', 1).maybeSingle();
    return data || { pack: null };
  }

  if (method === 'GET' && r0 === 'inbox') {
    const scope = query.get('scope') === 'all' ? 'all' : 'mine';
    return { scope, items: ok(await db.rpc('feedback_inbox', { p_scope: scope, p_actor: a.user_id })) };
  }

  if (r0 === 'assets' && !r1) {
    if (method === 'GET') {
      let q = db.from('assets').select('id, concept_name, kind, format, owner_id, latest_version, archived, updated_at').order('updated_at', { ascending: false }).limit(200);
      if (query.get('mine') === '1') q = q.eq('owner_id', a.user_id);
      const rows = ok(await q) as any[];
      return { items: rows.map(x => ({ ...x, link: link(x.id) })) };
    }
    if (method === 'POST') {
      if (!atLeast(a, 'creator')) throw new ApiError(403, 'forbidden', 'Creators only');
      const kind = String(body?.kind || ''); const format = String(body?.format || '');
      if (!['static', 'motion', 'video'].includes(kind)) throw new ApiError(400, 'invalid', 'kind must be static, motion or video');
      if (!['square', 'feed45', 'vertical', 'landscape'].includes(format)) throw new ApiError(400, 'invalid', 'format must be square, feed45, vertical or landscape');
      const name = String(body?.concept_name || '').trim().slice(0, 200);
      if (!name) throw new ApiError(400, 'invalid', 'concept_name is required');
      const row = ok(await db.from('assets').insert({ concept_name: name, kind, format, created_by: a.user_id, owner_id: a.user_id }).select('id, concept_name, kind, format, owner_id').single()) as any;
      return { ...row, link: link(row.id) };
    }
  }

  if (r0 === 'assets' && r1) {
    const assetId = r1;
    if (method === 'GET' && !r2) {
      const asset = ok(await db.from('assets').select('*').eq('id', assetId).maybeSingle()) as any;
      if (!asset) throw new ApiError(404, 'not_found', `Asset ${assetId} not found`);
      const versions = ok(await db.from('versions').select('*').eq('asset_id', assetId).order('version')) as any[];
      const comments = ok(await db.from('comments').select('id, version_id, author, legacy_author, body, at_sec, audio_path, status, applied_in, resolution_note, created_at, source, source_link').eq('asset_id', assetId).order('created_at')) as any[];
      const paths = versions.flatMap(v => [v.file_path, v.poster_path, v.source?.editable_path]).concat(comments.map(c => c.audio_path)).filter(Boolean);
      const signed: Record<string, string> = {};
      if (paths.length) { const { data } = await db.storage.from('ad-assets').createSignedUrls([...new Set(paths)], 3600); (data || []).forEach(d => { if (d.path && d.signedUrl) signed[d.path] = d.signedUrl; }); }
      const manage = await canManage(db, a, assetId);
      // Processing drafts and working chats are private to the owner/admin.
      const processing = manage ? (ok(await db.from('processing').select('*').eq('asset_id', assetId).order('created_at', { ascending: false }).limit(1)) as any[])[0] || null : null;
      const members = ok(await db.from('members').select('user_id, display_name')) as any[];
      const nameOf = (id?: string | null) => members.find(m => m.user_id === id)?.display_name || null;
      return {
        asset: { ...asset, owner_name: nameOf(asset.owner_id), link: link(assetId) }, you_can_manage: manage,
        versions: versions.map(v => ({ ...v, link: link(assetId, v.id), file_url: signed[v.file_path] || null, poster_url: signed[v.poster_path] || null, editable_url: signed[v.source?.editable_path] || null })),
        comments: comments.map(c => ({ ...c, author_name: nameOf(c.author) || c.legacy_author, audio_url: signed[c.audio_path] || null })),
        processing, urls_expire_in_seconds: 3600,
      };
    }

    if (method === 'POST' && r2 === 'comments') {
      if (!atLeast(a, 'creator')) throw new ApiError(403, 'forbidden', 'Creators only');
      const text = String(body?.body || '').trim();
      if (!text) throw new ApiError(400, 'invalid', 'body is required');
      const row = ok(await db.from('comments').insert({ asset_id: assetId, version_id: String(body?.version_id || ''), body: text.slice(0, 4000),
        at_sec: body?.at_sec ?? null, author: a.user_id, source: 'claude' }).select('id, version_id, created_at').single());
      return row;
    }

    if (method === 'POST' && r2 === 'uploads') {
      await requireManage(db, a, assetId);
      const files = Array.isArray(body?.files) ? body.files.slice(0, 10) : [];
      if (!files.length) throw new ApiError(400, 'invalid', 'files: [{ name, content_type }] required');
      const out = [];
      for (const f of files) {
        const ct = String(f?.content_type || '').toLowerCase();
        const ext = MEDIA_TYPES[ct];
        if (!ext) throw new ApiError(400, 'invalid', `content_type ${ct || '(none)'} not allowed. Report the real type; never rename WebM to MP4.`);
        const base = String(f?.name || 'file').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'file';
        const path = `${assetId}/${Date.now()}-${randomBytes(3).toString('hex')}-${base}.${ext}`;
        const { data, error } = await db.storage.from('ad-assets').createSignedUploadUrl(path);
        if (error || !data) throw new ApiError(500, 'upload_unavailable', error?.message || 'Could not create upload URL');
        out.push({ path, content_type: ct, upload_url: data.signedUrl, method: 'PUT', headers: { 'content-type': ct }, expires_in_seconds: 7200 });
      }
      return { uploads: out, next: 'PUT each file to its upload_url, then POST /assets/{id}/versions with the paths.' };
    }

    if (method === 'POST' && r2 === 'versions') {
      await requireManage(db, a, assetId);
      const b = body || {};
      const filePath = b.file_path ? String(b.file_path) : null;
      const pending = !filePath;
      if (pending && !['pending', 'rendering'].includes(String(b.render_state || ''))) throw new ApiError(400, 'invalid', 'file_path is required unless render_state is pending/rendering');
      for (const p of [filePath, b.poster_path, b.editable_path].filter(Boolean)) if (!String(p).startsWith(assetId + '/')) throw new ApiError(400, 'invalid', `${p} is not in this asset's folder`);
      // The bytes must really be in storage, with the size and type the client claims.
      let size: number | null = null; let ct: string | null = null;
      if (filePath) {
        const folder = filePath.slice(0, filePath.lastIndexOf('/')); const name = filePath.slice(filePath.lastIndexOf('/') + 1);
        const { data } = await db.storage.from('ad-assets').list(folder, { search: name, limit: 5 });
        const obj = (data || []).find(o => o.name === name) as any;
        if (!obj) throw new ApiError(400, 'missing_file', `${filePath} has not been uploaded`);
        size = Number(obj.metadata?.size ?? 0) || null; ct = obj.metadata?.mimetype || null;
        if (b.content_type && ct && ct !== b.content_type) throw new ApiError(400, 'type_mismatch', `Stored type is ${ct}, not ${b.content_type}`);
      }
      const key = b.idempotency_key ? String(b.idempotency_key).slice(0, 120) : null;
      if (key) {
        const { data: ex } = await db.from('versions').select('id, version').eq('asset_id', assetId).eq('source->>idempotency_key', key).maybeSingle();
        if (ex) return { ...ex, link: link(assetId, ex.id), duplicate: true };
      }
      const source = { ...(typeof b.source === 'object' && b.source ? b.source : {}), saved_via: 'claude-api', ...(key ? { idempotency_key: key } : {}),
        ...(b.editable_path ? { editable_path: String(b.editable_path) } : {}), ...(b.processing_id ? { processing_id: String(b.processing_id) } : {}) };
      const row = {
        id: 'pending', asset_id: assetId, version: 0, parent_version_id: b.parent_version_id || null, revision_note: b.revision_note ? String(b.revision_note).slice(0, 1000) : null,
        file_path: filePath, poster_path: b.poster_path || null, content_type: ct || b.content_type || null,
        width: b.width ?? null, height: b.height ?? null, duration_sec: b.duration_sec ?? null, size_bytes: size ?? b.size_bytes ?? null, sha256: b.sha256 || null,
        source, render: pending ? { state: b.render_state, note: b.render_note || 'Pending render' } : { state: 'ready' },
        spec: b.spec ?? null, copy: b.copy || {}, qa: Array.isArray(b.qa) ? b.qa : [], created_by: a.user_id,
      };
      const res = await db.from('versions').insert(row).select('id, version, parent_version_id').single();
      if (res.error && res.error.code === '23505' && key) {
        const { data: ex } = await db.from('versions').select('id, version').eq('asset_id', assetId).eq('source->>idempotency_key', key).maybeSingle();
        if (ex) return { ...ex, link: link(assetId, ex.id), duplicate: true };
      }
      const v = ok(res) as any;
      return { ...v, link: link(assetId, v.id) };
    }

    if (method === 'POST' && r2 === 'share') {
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) throw new ApiError(503, 'slack_not_connected', 'Slack sharing is not switched on yet. Share the library link instead.');
      const r = await shareVersion(db, slackApi(token), a, { asset_id: assetId, version_id: String(body?.version_id || ''), channel_id: String(body?.channel_id || ''), question: body?.question ?? null, idempotency_key: String(body?.idempotency_key || '') }, appUrl);
      if (r.status !== 200) throw new ApiError(r.status, (r.body as any).error || 'error', (r.body as any).message || 'Share failed');
      return r.body;
    }
    // One kind of feedback: approve/reject each item, then process every approved item.
    if (method === 'POST' && r2 === 'feedback' && parts[3] && parts[4] === 'decide') {
      return ok(await db.rpc('feedback_decide', { p_comment: parts[3], p_decision: String(body?.decision || ''), p_reason: body?.reason || null, p_actor: a.user_id }));
    }
    if (method === 'POST' && r2 === 'process-approved') {
      return ok(await db.rpc('feedback_process', { p_asset: assetId, p_note: body?.note || null, p_actor: a.user_id }));
    }
    if (method === 'POST' && r2 === 'processing') {
      return ok(await db.rpc('processing_start', { p_asset: assetId, p_via: 'claude', p_actor: a.user_id }));
    }
    if (method === 'POST' && r2 === 'revert') {
      const v = ok(await db.rpc('revert_asset', { p_asset: assetId, p_from_version: String(body?.from_version_id || ''), p_expected_latest: String(body?.expected_latest_version_id || ''), p_actor: a.user_id })) as any;
      return { ...v, link: link(assetId, v.id) };
    }
  }

  if (r0 === 'processing' && r1 && method === 'POST') {
    const b = body || {}; const rev = Number.isInteger(b.rev) ? b.rev : null;
    if (rev === null) throw new ApiError(400, 'invalid', 'rev (the review revision you last read) is required');
    if (r2 === 'proposal') return ok(await db.rpc('processing_save_proposal', { p_id: r1, p_rev: rev, p_proposal: b.proposal || {}, p_actor: a.user_id }));
    if (r2 === 'approve') return ok(await db.rpc('processing_approve', { p_id: r1, p_rev: rev, p_decisions: b.decisions || [], p_instructions: b.instructions || '', p_queue_worker: b.queue_worker === true, p_actor: a.user_id }));
    if (r2 === 'complete') return ok(await db.rpc('processing_complete', { p_id: r1, p_rev: rev, p_result_version: String(b.result_version_id || ''), p_note: b.note || null, p_actor: a.user_id }));
    if (r2 === 'status') return ok(await db.rpc('processing_set_status', { p_id: r1, p_rev: rev, p_status: String(b.status || ''), p_message: b.message || null, p_actor: a.user_id }));
  }

  throw new ApiError(404, 'not_found', `No route ${method} /api/v1/${parts.join('/')}`);
}
