import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, atLeast, dbError, requireManage, type Actor } from './api';

// Seedance 2.5 text-to-video on Higgsfield. Shane's settings: 4-12 s (default 9), always 720p, sound is a toggle,
// any creator can generate. Submission is a single POST with no retries, so one press is at most one billable request.
export const HF_MODEL = 'bytedance/seedance-2.5/text-to-video';
export const HF_BASE = 'https://api.higgsfield.ai';
export const FORMAT_RATIO: Record<string, string> = { vertical: '9:16', feed45: '3:4', square: '1:1', landscape: '16:9' };
const RATIO_FORMAT: Record<string, string> = Object.fromEntries(Object.entries(FORMAT_RATIO).map(([k, v]) => [v, k]));
export const DEFAULT_SECONDS = 9, MIN_SECONDS = 4, MAX_SECONDS = 12;

type Fetch = typeof fetch;
const auth = (creds: string) => ({ authorization: `Key ${creds}`, 'content-type': 'application/json', accept: 'application/json' });
const ok = <T>(x: { data: T; error: any }) => { if (x.error) throw dbError(x.error); return x.data; };

export function monthStart(now = new Date()) { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(); }

/** Seconds requested this month (failed submissions excluded). */
export async function usage(db: SupabaseClient, now = new Date()) {
  const rows = ok(await db.from('higgsfield_jobs').select('duration, status').gte('created_at', monthStart(now))) as any[];
  const used = rows.filter(r => r.status !== 'error').reduce((s, r) => s + r.duration, 0);
  const cap = Number(process.env.HIGGSFIELD_MONTHLY_SECONDS) || null;
  return { seconds_this_month: used, generations_this_month: rows.filter(r => r.status !== 'error').length, monthly_cap_seconds: cap };
}

export type GenerateInput = { asset_id?: string | null; concept_name?: string; prompt: string; duration?: number; format?: string; audio?: boolean; idempotency_key: string; chat_id?: string | null };

/** Server-only links for a regenerate render. Never taken from a request body. */
export type GenerateLink = { parentVersionId: string; processingId: string };

export async function generate(db: SupabaseClient, a: Actor, input: GenerateInput, creds: string, appUrl: string, fetcher: Fetch = fetch, link?: GenerateLink) {
  if (!atLeast(a, 'creator')) throw new ApiError(403, 'forbidden', 'Creators can generate videos. Ask Shane for Creator access.');
  const prompt = String(input.prompt || '').trim();
  if (!prompt || prompt.length > 4000) throw new ApiError(400, 'invalid', 'Describe the video (up to 4,000 characters).');
  const duration = Math.round(Number(input.duration ?? DEFAULT_SECONDS));
  if (!(duration >= MIN_SECONDS && duration <= MAX_SECONDS)) throw new ApiError(400, 'invalid', `Length must be ${MIN_SECONDS}-${MAX_SECONDS} seconds.`);
  // A new version of an existing ad keeps that ad's frame. Never silently turn a feed or square ad into 9:16.
  let format: string;
  if (input.asset_id) {
    const existing = ok(await db.from('assets').select('format, kind').eq('id', input.asset_id).maybeSingle()) as any;
    if (!existing) throw new ApiError(404, 'not_found', `Asset ${input.asset_id} not found`);
    if (existing.kind !== 'video') throw new ApiError(400, 'invalid', 'Higgsfield versions can only be added to a video ad.');
    if (input.format && input.format !== existing.format) throw new ApiError(400, 'invalid', `This ad is ${existing.format}; start a new ad for another format.`);
    format = existing.format;
  } else format = FORMAT_RATIO[input.format || ''] ? input.format! : 'vertical';
  if (!FORMAT_RATIO[format]) throw new ApiError(400, 'invalid', `Unsupported format ${format}`);
  const key = String(input.idempotency_key || '');
  if (!/^[\w-]{8,100}$/.test(key)) throw new ApiError(400, 'invalid', 'idempotency_key required');

  // Same press again (lost response, double click): return the first result, never submit twice.
  const prev = ok(await db.from('higgsfield_jobs').select('*').eq('idempotency_key', key).maybeSingle()) as any;
  if (prev) {
    await requireManage(db, a, prev.asset_id);
    if ((input.asset_id && input.asset_id !== prev.asset_id) || prev.prompt !== prompt || prev.duration !== duration
      || prev.aspect_ratio !== FORMAT_RATIO[format] || prev.audio !== !!input.audio)
      throw new ApiError(409, 'conflict', 'This request key was already used for different generation settings.');
    return { job: prev, asset_id: prev.asset_id, version_id: prev.version_id, repeated: true };
  }

  const u = await usage(db);
  if (u.monthly_cap_seconds && u.seconds_this_month + duration > u.monthly_cap_seconds)
    throw new ApiError(402, 'over_budget', `This month's Higgsfield budget (${u.monthly_cap_seconds}s) would be exceeded. Ask Shane to raise it.`);

  let assetId = input.asset_id || null;
  if (assetId) {
    await requireManage(db, a, assetId);
  } else {
    const name = (input.concept_name || prompt).trim().slice(0, 70);
    assetId = (ok(await db.from('assets').insert({ concept_name: name, kind: 'video', format, created_by: a.user_id, owner_id: a.user_id, chat_id: input.chat_id || null }).select('id').single()) as any).id;
  }
  const v = ok(await db.from('versions').insert({
    id: 'pending', asset_id: assetId, version: 0, created_by: a.user_id, parent_version_id: link?.parentVersionId ?? null,
    revision_note: link ? 'Regenerated in Higgsfield from approved feedback' : null,
    source: { tool: 'Higgsfield', model: HF_MODEL, prompt, idempotency_key: key, ...(input.chat_id ? { chatId: input.chat_id } : {}), ...(link ? { processing_id: link.processingId } : {}) },
    render: { state: 'rendering', kind: 'higgsfield', label: 'Rendering in Higgsfield', note: `${duration}s · 720p · ${input.audio ? 'with sound' : 'no sound'} · usually a few minutes` },
    spec: { type: 'higgsfield', prompt, duration, resolution: '720p', aspect_ratio: FORMAT_RATIO[format], audio: !!input.audio },
    copy: {}, qa: [],
  }).select('id, version').single()) as any;

  const job = ok(await db.from('higgsfield_jobs').insert({
    asset_id: assetId, version_id: v.id, requested_by: a.user_id, idempotency_key: key, prompt, duration,
    aspect_ratio: FORMAT_RATIO[format], resolution: '720p', audio: !!input.audio, status: 'submitting',
    ...(link ? { processing_id: link.processingId, parent_version_id: link.parentVersionId } : {}),
  }).select('*').single()) as any;

  const hook = `${appUrl}/api/higgsfield/webhook?job=${job.id}`;
  let res: Response, body: any = {};
  try {
    res = await fetcher(`${HF_BASE}/${HF_MODEL}?hf_webhook=${encodeURIComponent(hook)}`, {
      method: 'POST', headers: { ...auth(creds), 'Idempotency-Key': job.id }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ prompt, duration, resolution: '720p', aspect_ratio: FORMAT_RATIO[format], generate_audio: !!input.audio }),
    });
    body = await res.json().catch(() => ({}));
  } catch (e: any) {
    // We don't know whether Higgsfield accepted it. Don't resubmit; leave it for a person to check.
    // Keep the reservation and rendering state: an accepted request may still cost credits.
    ok(await db.from('higgsfield_jobs').update({ error: 'Submission outcome unknown. Check the Higgsfield dashboard before generating again.' }).eq('id', job.id));
    if (link) await processingMessage(db, link.processingId, 'Higgsfield didn’t answer in time, so it may be rendering. Check before trying again; nothing was retried.');
    throw new ApiError(504, 'timeout_unknown_outcome', `Higgsfield did not answer in time. Not retried, to avoid paying twice. Check generation ${job.id} before starting another.`);
  }
  // Only a 4xx is a definite refusal. A 5xx, or a 2xx without a request id, may still have been accepted and billed:
  // keep the job and its usage reservation, and never offer an automatic paid retry.
  if (res.ok && !body?.request_id || res.status >= 500) {
    ok(await db.from('higgsfield_jobs').update({ error: `Submission outcome unknown (HTTP ${res.status}${res.ok ? ', no request id' : ''}). Check the Higgsfield dashboard before generating again.` }).eq('id', job.id));
    if (link) await processingMessage(db, link.processingId, 'Higgsfield’s answer was unclear, so it may be rendering. Check before trying again; nothing was retried.');
    throw new ApiError(502, 'unknown_outcome', `Higgsfield's answer was unclear (HTTP ${res.status}). Not retried, to avoid paying twice. Check generation ${job.id} before starting another.`);
  }
  if (!res.ok) {
    const msg = res.status === 402 || /credit/i.test(JSON.stringify(body)) ? 'Not enough Higgsfield credits.' : `Higgsfield refused the request (${res.status}).`;
    await fail(db, job, v.id, 'error', msg);
    throw new ApiError(res.status === 402 ? 402 : 502, 'higgsfield_refused', msg);
  }
  const saved = ok(await db.from('higgsfield_jobs').update({ request_id: body.request_id, status: 'submitted' }).eq('id', job.id).select('*').single()) as any;
  return { job: saved, asset_id: assetId, version_id: v.id, repeated: false };
}

async function fail(db: SupabaseClient, job: any, versionId: string, status: string, error: string) {
  const { data } = await db.from('higgsfield_jobs').update({ status, error, finished_at: new Date().toISOString() })
    .eq('id', job.id).in('status', ['submitting', 'submitted']).select('id');
  if (!data?.length) return false; // someone else finished it
  const { data: ver } = await db.from('versions').select('render').eq('id', versionId).maybeSingle();
  ok(await db.from('versions').update({ render: { ...(ver?.render || {}), state: 'failed', label: 'Higgsfield render failed', note: error } }).eq('id', versionId));
  if (job.processing_id) await finishProcessing(db, job, 'failed', error);
  return true;
}

async function processingMessage(db: SupabaseClient, processingId: string, message: string) {
  await db.from('processing').update({ message, updated_at: new Date().toISOString() }).eq('id', processingId).in('status', ['executing']);
}

/** Close the regenerate row linked to a job. 'done' only after the version holds playable media; marks feedback applied. */
async function finishProcessing(db: SupabaseClient, job: any, outcome: 'done' | 'failed', message: string | null) {
  const p = ok(await db.from('processing').select('id, rev, status').eq('id', job.processing_id).maybeSingle()) as any;
  if (!p || !['approved', 'executing'].includes(p.status)) return; // already closed (done, failed or cancelled)
  const r = outcome === 'done'
    ? await db.rpc('processing_complete', { p_id: p.id, p_rev: p.rev, p_result_version: job.version_id, p_note: message, p_actor: job.requested_by })
    : await db.rpc('processing_set_status', { p_id: p.id, p_rev: p.rev, p_status: 'failed', p_message: message, p_actor: job.requested_by });
  if (r.error && !/conflict/i.test(r.error.message || '')) throw dbError(r.error); // a concurrent poll finished it first
}

/** Read the duration and frame size from an MP4 (mvhd + first tkhd with a size). */
export function mp4Info(buf: Uint8Array): { duration: number | null; width: number | null; height: number | null } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = { duration: null as number | null, width: null as number | null, height: null as number | null };
  const walk = (start: number, end: number) => {
    let p = start;
    while (p + 8 <= end) {
      let size = dv.getUint32(p); const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]); let hdr = 8;
      if (size === 1) { if (p + 16 > end) return; size = Number(dv.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) return;
      const b = p + hdr;
      if (['moov', 'trak'].includes(type)) walk(b, p + size);
      else if (type === 'mvhd') {
        const v1 = buf[b] === 1; if (b + (v1 ? 32 : 20) > p + size) return;
        const ts = dv.getUint32(b + (v1 ? 20 : 12)); const d = v1 ? Number(dv.getBigUint64(b + 24)) : dv.getUint32(b + 16);
        if (ts) out.duration = Math.round((d / ts) * 1000) / 1000;
      } else if (type === 'tkhd' && out.width == null) {
        const off = b + (buf[b] === 1 ? 88 : 76); if (off + 8 > p + size) return;
        const w = dv.getUint32(off) / 65536, h = dv.getUint32(off + 4) / 65536;
        if (w && h) { out.width = Math.round(w); out.height = Math.round(h); }
      }
      p += size;
    }
  };
  walk(0, buf.byteLength);
  return out;
}

/** Ask Higgsfield once, and finish the version if the render is done. Safe to call from anywhere, any number of times. */
export async function refresh(db: SupabaseClient, jobId: string, creds: string, fetcher: Fetch = fetch) {
  const job = ok(await db.from('higgsfield_jobs').select('*').eq('id', jobId).maybeSingle()) as any;
  if (!job) throw new ApiError(404, 'not_found', 'No such generation');
  if (!['submitted', 'completed'].includes(job.status) || !job.request_id) return job;
  const ver = ok(await db.from('versions').select('file_path, render').eq('id', job.version_id).single()) as any;
  // A previous attempt may have saved the version but lost the final job acknowledgement.
  if (ver.file_path && ver.render?.state === 'ready') {
    if (job.status !== 'completed') ok(await db.from('higgsfield_jobs').update({ status: 'completed', error: null, finished_at: new Date().toISOString() }).eq('id', job.id));
    if (job.processing_id) await finishProcessing(db, job, 'done', 'Regenerated in Higgsfield');
    return { ...job, status: 'completed', error: null };
  }
  const r = await fetcher(`${HF_BASE}/requests/${encodeURIComponent(job.request_id)}/status`, { headers: auth(creds), signal: AbortSignal.timeout(20_000) });
  const s = await r.json().catch(() => ({}));
  if (!r.ok) return job;
  if (s.status === 'nsfw') { await fail(db, job, job.version_id, 'nsfw', 'Higgsfield blocked this prompt (content moderation). No credits are charged for blocked requests. Rephrase and generate again.'); }
  else if (s.status === 'failed' || s.status === 'canceled' || s.status === 'cancelled') { await fail(db, job, job.version_id, 'failed', `Higgsfield ${s.status === 'failed' ? 'failed to render this' : 'cancelled this request'}. Generate again to retry.`); }
  else if (s.status === 'completed') {
    const url = s.video?.url || s.videos?.[0]?.url;
    if (!url) { await fail(db, job, job.version_id, 'failed', 'Higgsfield said done but sent no video.'); }
    else {
      const vr = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
      if (!vr.ok) return job; // try again next poll
      const bytes = new Uint8Array(await vr.arrayBuffer());
      if (bytes.byteLength < 1000 || String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') { await fail(db, job, job.version_id, 'failed', 'Higgsfield returned something that is not an MP4.'); }
      else {
        // Stable storage path + conditional version write make concurrent polls and recovery safe.
        // A job is complete only AFTER both storage and the version record are ready.
        const path = `${job.asset_id}/${job.id}-higgsfield.mp4`;
        const hash = createHash('sha256').update(bytes).digest('hex');
        const bucket = db.storage.from('ad-assets');
        const up = await bucket.upload(path, bytes, { contentType: 'video/mp4', upsert: false });
        if (up.error) {
          // Another poll (or an interrupted prior attempt) may already have uploaded it.
          const existing = await bucket.download(path);
          if (existing.error || !existing.data || createHash('sha256').update(new Uint8Array(await existing.data.arrayBuffer())).digest('hex') !== hash)
            throw dbError(up.error);
        }
        const info = mp4Info(bytes);
        ok(await db.from('versions').update({
          file_path: path, content_type: 'video/mp4', size_bytes: bytes.byteLength, sha256: hash,
          duration_sec: info.duration, width: info.width, height: info.height,
          render: { ...(ver.render || {}), state: 'ready', label: null, note: null, audio: job.audio ? 'generated' : 'none', request_id: job.request_id },
        }).eq('id', job.version_id).is('file_path', null));
        const ready = ok(await db.from('versions').select('file_path, render').eq('id', job.version_id).single()) as any;
        if (ready.file_path !== path || ready.render?.state !== 'ready') throw new ApiError(409, 'conflict', 'The generation result changed while it was being saved.');
        ok(await db.from('higgsfield_jobs').update({ status: 'completed', result_url: url, error: null, finished_at: new Date().toISOString() }).eq('id', job.id));
        if (job.processing_id) await finishProcessing(db, job, 'done', 'Regenerated in Higgsfield');
      }
    }
  }
  return ok(await db.from('higgsfield_jobs').select('*').eq('id', jobId).single()) as any;
}

/** Prompt for a regenerate: the parent's prompt plus the frozen, approved feedback and the owner's note. */
export function revisionPrompt(parentPrompt: string, snapshot: { body: string; author_name?: string; at_sec?: number | null }[], note: string | null) {
  const items = snapshot.filter(x => x.body && x.body !== 'Voice note').map(x => `- ${x.body.trim()}${x.at_sec != null ? ` (at ${x.at_sec}s)` : ''}`);
  const parts = [parentPrompt.trim(), 'Make a new version of this video with these approved changes:', ...items];
  if (note?.trim()) parts.push(`Owner's note: ${note.trim()}`);
  const text = parts.join('\n');
  if (!items.length && !note?.trim()) throw new ApiError(400, 'invalid', 'Approve at least one written feedback item, or add a note. Voice notes without a transcript can’t steer a render.');
  if (text.length > 4000) throw new ApiError(400, 'invalid', 'The approved feedback is too long for one render. Approve fewer items or shorten the note.');
  return text;
}

/** Regenerate a Higgsfield video from approved feedback: one paid render on the exact reviewed version. Owner/admin. */
export async function startHiggsfieldRevision(db: SupabaseClient, a: Actor, assetId: string, note: string | null, creds: string, appUrl: string, fetcher: Fetch = fetch) {
  await requireManage(db, a, assetId);
  const p = ok(await db.rpc('higgsfield_revision_start', { p_asset: assetId, p_note: note, p_actor: a.user_id })) as any;
  const existing = ok(await db.from('higgsfield_jobs').select('*').eq('processing_id', p.id).maybeSingle()) as any;
  if (existing) return { processing_id: p.id, job: existing, asset_id: assetId, version_id: existing.version_id, repeated: true };
  // Only the caller that wins the claim creates the version and pays. Everyone else reports "already starting" and
  // never generates or closes the run, so a losing double click can't fail the winner's render.
  if (!ok(await db.rpc('higgsfield_revision_claim', { p_processing: p.id }))) {
    const now = ok(await db.from('higgsfield_jobs').select('*').eq('processing_id', p.id).maybeSingle()) as any;
    return { processing_id: p.id, job: now ?? null, asset_id: assetId, version_id: now?.version_id ?? null, repeated: true, starting: !now };
  }
  const parent = ok(await db.from('versions').select('id, spec').eq('id', p.reviewed_version_id).single()) as any;
  const spec = parent.spec || {};
  const format = RATIO_FORMAT[spec.aspect_ratio];
  const close = async (msg: string) => { await db.rpc('processing_set_status', { p_id: p.id, p_rev: p.rev, p_status: 'failed', p_message: msg, p_actor: a.user_id }); };
  if (!format || !spec.prompt || !(spec.duration >= MIN_SECONDS && spec.duration <= MAX_SECONDS)) { await close('The previous version has no usable Higgsfield settings.'); throw new ApiError(400, 'invalid', 'The previous version has no usable Higgsfield settings to regenerate from.'); }
  let prompt: string;
  try { prompt = revisionPrompt(spec.prompt, p.feedback_snapshot || [], p.instructions); } catch (e: any) { await close(e.message); throw e; }
  try {
    const r = await generate(db, a, { asset_id: assetId, prompt, duration: spec.duration, format, audio: !!spec.audio, idempotency_key: `rev-${p.id}` }, creds, appUrl, fetcher,
      { parentVersionId: p.reviewed_version_id, processingId: p.id });
    return { processing_id: p.id, ...r };
  } catch (e: any) {
    // Definite refusals (over budget, 4xx) close the row; feedback stays approved. Unknown outcomes keep it open.
    if (e instanceof ApiError && !['unknown_outcome', 'timeout_unknown_outcome'].includes(e.code)) {
      const job = ok(await db.from('higgsfield_jobs').select('id').eq('processing_id', p.id).maybeSingle());
      if (!job) await close(e.message);
    }
    throw e;
  }
}
