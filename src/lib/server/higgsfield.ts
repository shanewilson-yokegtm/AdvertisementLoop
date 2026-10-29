import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, atLeast, dbError, requireManage, type Actor } from './api';

// Seedance 2.5 text-to-video on Higgsfield. Shane's settings: 4-12 s (default 9), always 720p, sound is a toggle,
// any creator can generate. Submission is a single POST with no retries, so one press is at most one billable request.
export const HF_MODEL = 'bytedance/seedance-2.5/text-to-video';
export const HF_BASE = 'https://api.higgsfield.ai';
export const FORMAT_RATIO: Record<string, string> = { vertical: '9:16', feed45: '3:4', square: '1:1', landscape: '16:9' };
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

export async function generate(db: SupabaseClient, a: Actor, input: GenerateInput, creds: string, appUrl: string, fetcher: Fetch = fetch) {
  if (!atLeast(a, 'creator')) throw new ApiError(403, 'forbidden', 'Creators can generate videos. Ask Shane for Creator access.');
  const prompt = String(input.prompt || '').trim();
  if (!prompt || prompt.length > 4000) throw new ApiError(400, 'invalid', 'Describe the video (up to 4,000 characters).');
  const duration = Math.round(Number(input.duration ?? DEFAULT_SECONDS));
  if (!(duration >= MIN_SECONDS && duration <= MAX_SECONDS)) throw new ApiError(400, 'invalid', `Length must be ${MIN_SECONDS}-${MAX_SECONDS} seconds.`);
  const format = FORMAT_RATIO[input.format || ''] ? input.format! : 'vertical';
  const key = String(input.idempotency_key || '');
  if (!/^[\w-]{8,100}$/.test(key)) throw new ApiError(400, 'invalid', 'idempotency_key required');

  // Same press again (lost response, double click): return the first result, never submit twice.
  const prev = ok(await db.from('higgsfield_jobs').select('*').eq('idempotency_key', key).maybeSingle()) as any;
  if (prev) return { job: prev, asset_id: prev.asset_id, version_id: prev.version_id, repeated: true };

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
    id: 'pending', asset_id: assetId, version: 0, created_by: a.user_id,
    source: { tool: 'Higgsfield', model: HF_MODEL, prompt, idempotency_key: key, ...(input.chat_id ? { chatId: input.chat_id } : {}) },
    render: { state: 'rendering', kind: 'higgsfield', label: 'Rendering in Higgsfield', note: `${duration}s · 720p · ${input.audio ? 'with sound' : 'no sound'} · usually a few minutes` },
    spec: { type: 'higgsfield', prompt, duration, resolution: '720p', aspect_ratio: FORMAT_RATIO[format], audio: !!input.audio },
    copy: {}, qa: [],
  }).select('id, version').single()) as any;

  const job = ok(await db.from('higgsfield_jobs').insert({
    asset_id: assetId, version_id: v.id, requested_by: a.user_id, idempotency_key: key, prompt, duration,
    aspect_ratio: FORMAT_RATIO[format], resolution: '720p', audio: !!input.audio, status: 'submitting',
  }).select('*').single()) as any;

  const hook = `${appUrl}/api/higgsfield/webhook?job=${job.id}`;
  let res: Response, body: any = {};
  try {
    res = await fetcher(`${HF_BASE}/${HF_MODEL}?hf_webhook=${encodeURIComponent(hook)}`, {
      method: 'POST', headers: auth(creds), signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ prompt, duration, resolution: '720p', aspect_ratio: FORMAT_RATIO[format], generate_audio: !!input.audio }),
    });
    body = await res.json().catch(() => ({}));
  } catch (e: any) {
    // We don't know whether Higgsfield accepted it. Don't resubmit; leave it for a person to check.
    await fail(db, job, v.id, 'error', 'Higgsfield did not answer. It may still be rendering; check the Higgsfield dashboard before trying again.');
    throw new ApiError(504, 'timeout_unknown_outcome', 'Higgsfield did not answer in time. Not retried, to avoid paying twice.');
  }
  if (!res.ok || !body?.request_id) {
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
  return true;
}

/** Read the duration and frame size from an MP4 (mvhd + first tkhd with a size). */
export function mp4Info(buf: Uint8Array): { duration: number | null; width: number | null; height: number | null } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = { duration: null as number | null, width: null as number | null, height: null as number | null };
  const walk = (start: number, end: number) => {
    let p = start;
    while (p + 8 <= end) {
      let size = dv.getUint32(p); const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]); let hdr = 8;
      if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) return;
      const b = p + hdr;
      if (['moov', 'trak'].includes(type)) walk(b, p + size);
      else if (type === 'mvhd') {
        const v1 = buf[b] === 1; const ts = dv.getUint32(b + (v1 ? 20 : 12)); const d = v1 ? Number(dv.getBigUint64(b + 24)) : dv.getUint32(b + 16);
        if (ts) out.duration = Math.round((d / ts) * 1000) / 1000;
      } else if (type === 'tkhd' && out.width == null) {
        const off = b + (buf[b] === 1 ? 88 : 76); const w = dv.getUint32(off) / 65536, h = dv.getUint32(off + 4) / 65536;
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
  if (job.status !== 'submitted' || !job.request_id) return job;
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
        // Claim the finish first so two pollers can't both write.
        const claim = ok(await db.from('higgsfield_jobs').update({ status: 'completed', result_url: url, finished_at: new Date().toISOString() })
          .eq('id', job.id).eq('status', 'submitted').select('id')) as any[];
        if (claim.length) {
          const path = `${job.asset_id}/${Date.now()}-higgsfield-${randomUUID().slice(0, 8)}.mp4`;
          const up = await db.storage.from('ad-assets').upload(path, bytes, { contentType: 'video/mp4', upsert: false });
          if (up.error) {
            await db.from('higgsfield_jobs').update({ status: 'submitted', finished_at: null }).eq('id', job.id); // let the next poll retry
            throw dbError(up.error);
          }
          const info = mp4Info(bytes);
          const { data: ver } = await db.from('versions').select('render').eq('id', job.version_id).maybeSingle();
          ok(await db.from('versions').update({
            file_path: path, content_type: 'video/mp4', size_bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
            duration_sec: info.duration, width: info.width, height: info.height,
            render: { ...(ver?.render || {}), state: 'ready', label: null, note: null, audio: job.audio ? 'generated' : 'none', request_id: job.request_id },
          }).eq('id', job.version_id));
        }
      }
    }
  }
  return ok(await db.from('higgsfield_jobs').select('*').eq('id', jobId).single()) as any;
}
