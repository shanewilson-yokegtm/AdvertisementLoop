'use client';
import { useEffect, useState, useCallback } from 'react';
import { sb } from './supabase/browser';

export type Member = { user_id: string; email: string; display_name: string; role: 'viewer' | 'creator' | 'approver' | 'admin' };
export type Asset = { id: string; concept_name: string; kind: 'static' | 'motion' | 'video'; format: string; archived: boolean; archived_note: string | null; chat_id: string | null; owner_id: string | null; latest_version: number; created_by: string | null; legacy_creator: string | null; created_at: string; updated_at: string };
export type Version = { id: string; asset_id: string; version: number; parent_version_id: string | null; revision_note: string | null; file_path: string | null; poster_path: string | null; content_type: string | null; width: number | null; height: number | null; duration_sec: number | null; size_bytes: number | null; sha256: string | null; source: Record<string, any>; render: Record<string, any>; spec: any; copy: Record<string, any>; qa: any[]; created_by: string | null; legacy_creator: string | null; created_at: string };
export type Comment = { id: string; asset_id: string; version_id: string; author: string | null; legacy_author: string | null; body: string; at_sec: number | null; status: string; applied_in: string | null; created_at: string; audio_path?: string | null; audio_sec?: number | null; resolution_note?: string | null; resolved_by?: string | null; resolved_at?: string | null; source?: string | null; source_link?: string | null };
export type Review = { version_id: string; status: 'approved' | 'changes'; note: string | null; reviewer: string | null; at: string };

export const FORMATS: Record<string, { label: string; w: number; h: number }> = {
  square: { label: '1:1', w: 1080, h: 1080 }, feed45: { label: '4:5', w: 1080, h: 1350 }, vertical: { label: '9:16', w: 1080, h: 1920 }, landscape: { label: '1.91:1', w: 1200, h: 628 },
};
export const KIND_LABEL: Record<string, string> = { static: 'Static', motion: 'Motion', video: 'Video' };
export const ROLE_RANK = ['none', 'viewer', 'creator', 'approver', 'admin'];
export const can = (m: Member | null, min: string) => !!m && ROLE_RANK.indexOf(m.role) >= ROLE_RANK.indexOf(min);
export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '--');
export const fmtSec = (s?: number | null) => { const n = Math.max(0, Math.round(Number(s) || 0)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };
export const fmtBytes = (b?: number | null) => (b == null ? '--' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB');
export const isVideo = (v?: Version | null) => !!v && (v.content_type || '').startsWith('video/');

// ---- signed media URLs (private bucket) ----
const urlCache = new Map<string, { url: string; exp: number }>();
export async function signed(paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const now = Date.now(); const want = [...new Set(paths.filter(Boolean) as string[])].filter(p => !(urlCache.get(p)?.exp! > now + 300_000));
  if (want.length) {
    const { data } = await sb().storage.from('ad-assets').createSignedUrls(want, 3600);
    (data || []).forEach(d => { if (d.path && d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: now + 3600_000 }); });
  }
  const out: Record<string, string> = {}; paths.forEach(p => { const cached = p ? urlCache.get(p) : null; if (p && cached && cached.exp > Date.now()) out[p] = cached.url; }); return out;
}
export function useSigned(paths: (string | null | undefined)[]) {
  const key = JSON.stringify([...new Set(paths.filter(Boolean))]); const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true, refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try { const next = await signed(JSON.parse(key)); if (live) setUrls(next); }
      catch { /* Keep the last working URLs and retry on the next tick or focus. */ }
      finally { refreshing = false; }
    };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => { live = false; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', visible); };
  }, [key]);
  return urls;
}

// ---- session member ----
export function useMember() {
  const [state, set] = useState<{ loading: boolean; member: Member | null; email: string | null }>({ loading: true, member: null, email: null });
  useEffect(() => {
    let live = true;
    (async () => {
      const { data: { user } } = await sb().auth.getUser();
      if (!user) { live && set({ loading: false, member: null, email: null }); return; }
      const { data } = await sb().from('members').select('user_id,email,display_name,role').eq('user_id', user.id).maybeSingle();
      live && set({ loading: false, member: (data as Member) || null, email: user.email || null });
    })();
    return () => { live = false; };
  }, []);
  return state;
}

export function useMembers() {
  const [map, setMap] = useState<Record<string, Member>>({});
  useEffect(() => { sb().from('members').select('user_id,email,display_name,role').then(({ data }) => setMap(Object.fromEntries((data || []).map((m: any) => [m.user_id, m])))); }, []);
  return useCallback((id?: string | null, legacy?: string | null) => (id && map[id] ? map[id].display_name : legacy || (id ? 'Teammate' : 'Claude')), [map]);
}

// ---- live table rows ----
export function useRows<T>(table: string, opts: { order?: string; asc?: boolean; filter?: [string, string] } = {}) {
  const [rows, setRows] = useState<T[]>([]); const [ready, setReady] = useState(false); const [err, setErr] = useState<string | null>(null);
  const key = table + JSON.stringify(opts);
  const load = useCallback(async () => {
    let q: any = sb().from(table).select('*');
    if (opts.filter) q = q.eq(opts.filter[0], opts.filter[1]);
    if (opts.order) q = q.order(opts.order, { ascending: !!opts.asc });
    const { data, error } = await q.limit(1000);
    if (error) setErr(error.message); else { setRows(data as T[]); setErr(null); }
    setReady(true);
  }, [key]); // eslint-disable-line
  useEffect(() => {
    load();
    const ch = sb().channel('rt-' + key + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table, ...(opts.filter ? { filter: `${opts.filter[0]}=eq.${opts.filter[1]}` } : {}) }, () => load())
      .subscribe();
    const iv = setInterval(load, 30_000); // safety net if realtime drops
    return () => { sb().removeChannel(ch); clearInterval(iv); };
  }, [key]); // eslint-disable-line
  return { rows, ready, err, reload: load };
}

export async function sha256(blob: Blob) {
  const b = await blob.arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Upload a file (and optional poster) and add it as the next version of an asset (new asset when assetId is null). */
export async function saveVersion(input: {
  assetId?: string | null; newAsset?: { concept_name: string; kind: Asset['kind']; format: string; chat_id?: string | null };
  file?: Blob | null; poster?: Blob | null; width?: number; height?: number; duration?: number | null;
  source?: any; render?: any; spec?: any; copy?: any; qa?: any[]; revisionNote?: string | null;
}): Promise<{ assetId: string; versionId: string; version: number }> {
  const s = sb();
  let assetId = input.assetId || null;
  if (!assetId) {
    const { data, error } = await s.from('assets').insert(input.newAsset!).select('id').single();
    if (error) throw error; assetId = data.id as string;
  }
  const up = async (b: Blob, label: string) => {
    const ext = (b.type.split('/')[1] || 'bin').replace('quicktime', 'mov').replace('jpeg', 'jpg').split(';')[0];
    const path = `${assetId}/${Date.now()}-${label}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await s.storage.from('ad-assets').upload(path, b, { contentType: b.type, upsert: false });
    if (error) throw error; return path;
  };
  const file_path = input.file ? await up(input.file, 'file') : null;
  const poster_path = input.poster ? await up(input.poster, 'poster') : null;
  const row = {
    id: 'pending', asset_id: assetId, version: 0, file_path, poster_path,
    content_type: input.file ? input.file.type.split(';')[0] : null, width: input.width ?? null, height: input.height ?? null,
    duration_sec: input.duration ?? null, size_bytes: input.file ? input.file.size : null, sha256: input.file ? await sha256(input.file) : null,
    source: input.source || {}, render: input.render || { state: 'ready' }, spec: input.spec ?? null, copy: input.copy || {}, qa: input.qa || [],
    revision_note: input.revisionNote || null,
  };
  const { data, error } = await s.from('versions').insert(row).select('id,version').single();
  if (error) throw error;
  return { assetId, versionId: data.id as string, version: data.version as number };
}

/** Owner or admin: may revise, revert, process feedback, reject. Enforced by the database too. */
export const canManage = (m: Member | null, a?: { owner_id: string | null } | null) => !!m && !!a && (m.role === 'admin' || (a.owner_id === m.user_id && can(m, 'creator')));

export type InboxRow = { asset_id: string; concept_name: string; owner_id: string; owner_name: string; pending: number; latest_feedback_at: string; processing_status: string | null; processor: string | null };
/** Feedback to process, computed on the server: 'mine' = ads I own; 'all' = admin queue. */
export function useInbox(scope: 'mine' | 'all', enabled = true) {
  const [rows, setRows] = useState<InboxRow[]>([]); const [ready, setReady] = useState(false);
  const load = useCallback(async () => {
    if (!enabled) { setRows([]); setReady(true); return; }
    const { data, error } = await sb().rpc('feedback_inbox', { p_scope: scope });
    if (!error) setRows((data || []) as InboxRow[]); setReady(true);
  }, [scope, enabled]);
  useEffect(() => {
    load();
    const ch = sb().channel('inbox-' + scope + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => load()).subscribe();
    const iv = setInterval(load, 30_000);
    return () => { sb().removeChannel(ch); clearInterval(iv); };
  }, [load, scope]);
  return { rows, ready, reload: load, total: rows.reduce((n, r) => n + r.pending, 0) };
}
