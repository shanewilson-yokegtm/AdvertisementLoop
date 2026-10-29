'use client';
import { useEffect, useRef, useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { fmtSec } from '@/lib/data';

const MAX_SEC = 180;
const pickType = () => {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported(t)) return t;
  return '';
};

export type Recording = { blob: Blob; url: string; sec: number; at: number | null };

/** Microphone recorder with a live transcript (where the browser offers speech recognition).
 *  onText receives the running transcript of this take; the recording is kept until cleared. */
export function useRecorder(opts: { playheadSec?: () => number | null; onText?: (t: string) => void; toast: (m: string) => void }) {
  const [state, setState] = useState<'idle' | 'rec' | 'done'>('idle');
  const [sec, setSec] = useState(0); const [take, setTake] = useState<Recording | null>(null);
  const [supported, setSupported] = useState(false);
  const rec = useRef<MediaRecorder | null>(null); const chunks = useRef<Blob[]>([]); const t0 = useRef(0); const at = useRef<number | null>(null);
  const timer = useRef<any>(null); const speech = useRef<any>(null); const finalText = useRef(''); const o = useRef(opts); o.current = opts;
  useEffect(() => { setSupported(!!navigator.mediaDevices?.getUserMedia && pickType() !== null); }, []);
  const stop = () => { clearInterval(timer.current); try { speech.current?.stop(); } catch {} if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); };
  useEffect(() => () => stop(), []); // eslint-disable-line
  const start = async () => {
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { o.current.toast('Microphone blocked · allow it in the browser’s site settings'); return; }
    const type = pickType() || undefined;
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks.current = []; finalText.current = '';
    r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks.current, { type: (r.mimeType || 'audio/webm').split(';')[0] });
      const s = Math.max(0.1, Math.round(((Date.now() - t0.current) / 1000) * 10) / 10);
      setTake(prev => { if (prev) URL.revokeObjectURL(prev.url); return { blob, url: URL.createObjectURL(blob), sec: s, at: at.current }; });
      setState('done');
    };
    at.current = o.current.playheadSec ? o.current.playheadSec() : null;
    document.querySelectorAll('video').forEach(v => v.pause());
    r.start(250); rec.current = r; t0.current = Date.now(); setSec(0); setState('rec');
    timer.current = setInterval(() => { const s = (Date.now() - t0.current) / 1000; setSec(s); if (s >= MAX_SEC) stop(); }, 200);
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      const s = new SR(); s.continuous = true; s.interimResults = true; s.lang = navigator.language || 'en-US';
      s.onresult = (e: any) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) finalText.current += res[0].transcript.trim() + ' '; else interim += res[0].transcript; }
        o.current.onText?.((finalText.current + interim).trim());
      };
      s.onerror = () => {}; try { s.start(); speech.current = s; } catch {}
    }
  };
  const clear = () => { setTake(prev => { if (prev) URL.revokeObjectURL(prev.url); return null; }); setState('idle'); };
  return { state, sec, take, supported, start, stop, clear };
}

/** Upload a take and save it as a comment on the version. Returns the comment id. */
export async function saveVoiceComment(assetId: string, versionId: string, take: Recording | null, body: string) {
  let audio_path: string | null = null;
  if (take) {
    const ext = take.blob.type.includes('mp4') ? 'm4a' : take.blob.type.includes('ogg') ? 'ogg' : 'webm';
    audio_path = `comments/${assetId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await sb().storage.from('ad-assets').upload(audio_path, take.blob, { contentType: take.blob.type, upsert: false });
    if (up.error) throw up.error;
  }
  const { data, error } = await sb().from('comments').insert({ asset_id: assetId, version_id: versionId, body: body.trim() || 'Voice note', at_sec: take?.at ?? null, audio_path, audio_sec: take ? take.sec : null }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

/** Big record control + live status, shared by the review box and the comment box. */
export function RecordControl({ r, label = 'Record feedback' }: { r: ReturnType<typeof useRecorder>; label?: string }) {
  if (!r.supported) return null;
  if (r.state === 'rec') return <div className="row" role="status">
    <span className="recdot" aria-hidden="true" /><b>Recording {fmtSec(r.sec)}</b>
    <button type="button" className="btn primary" onClick={r.stop}>Stop</button></div>;
  if (r.take) return <div className="row" style={{ flexWrap: 'nowrap' }}>
    <audio controls src={r.take.url} style={{ flex: 1, minWidth: 0, height: 40 }} aria-label="Your recording" />
    <span className="muted">{fmtSec(r.take.sec)}{r.take.at != null ? ' · at ' + fmtSec(r.take.at) : ''}</span>
    <button type="button" className="btn small" onClick={r.start}>Re-record</button>
    <button type="button" className="btn small" onClick={r.clear}>Remove</button></div>;
  return <button type="button" className="btn rec" onClick={r.start}><span className="recdot still" aria-hidden="true" />{label}</button>;
}
