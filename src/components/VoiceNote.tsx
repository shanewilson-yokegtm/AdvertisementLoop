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

/** Record a voice note on an ad: captures the playhead when recording starts, live-transcribes where the
 *  browser supports it, and saves the clip + transcript as one comment. */
export default function VoiceNote({ assetId, versionId, playheadSec, toast }: {
  assetId: string; versionId: string; playheadSec: () => number | null; toast: (m: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'rec' | 'review' | 'saving'>('idle');
  const [sec, setSec] = useState(0); const [text, setText] = useState(''); const [url, setUrl] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null); const chunks = useRef<Blob[]>([]); const blob = useRef<Blob | null>(null);
  const t0 = useRef(0); const at = useRef<number | null>(null); const timer = useRef<any>(null); const speech = useRef<any>(null);
  const finalText = useRef('');
  const [supported, setSupported] = useState(false);
  useEffect(() => { setSupported(!!navigator.mediaDevices?.getUserMedia && pickType() !== null); }, []);

  useEffect(() => () => { stopAll(); if (url) URL.revokeObjectURL(url); }, []); // eslint-disable-line

  const stopAll = () => {
    clearInterval(timer.current);
    try { speech.current?.stop(); } catch {}
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
  };

  const start = async () => {
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast('Microphone blocked · allow it in the browser’s site settings'); return; }
    const type = pickType() || undefined;
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks.current = []; finalText.current = ''; setText('');
    r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const b = new Blob(chunks.current, { type: (r.mimeType || 'audio/webm').split(';')[0] });
      blob.current = b; setUrl(URL.createObjectURL(b)); setState('review');
    };
    at.current = playheadSec();
    document.querySelectorAll('video').forEach(v => v.pause());
    r.start(250); rec.current = r; t0.current = Date.now(); setSec(0); setState('rec');
    timer.current = setInterval(() => { const s = (Date.now() - t0.current) / 1000; setSec(s); if (s >= MAX_SEC) stop(); }, 200);
    // Live transcript where the browser offers it (Chrome, Edge, Safari). Editable before saving.
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      const s = new SR(); s.continuous = true; s.interimResults = true; s.lang = navigator.language || 'en-US';
      s.onresult = (e: any) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) finalText.current += res[0].transcript.trim() + ' '; else interim += res[0].transcript; }
        setText((finalText.current + interim).trim());
      };
      s.onerror = () => {}; try { s.start(); speech.current = s; } catch {}
    }
  };
  const stop = () => { stopAll(); };
  const discard = () => { if (url) URL.revokeObjectURL(url); setUrl(null); blob.current = null; setText(''); setState('idle'); };

  const save = async () => {
    const b = blob.current; if (!b) return;
    setState('saving');
    const ext = b.type.includes('mp4') ? 'm4a' : b.type.includes('ogg') ? 'ogg' : 'webm';
    const path = `comments/${assetId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await sb().storage.from('ad-assets').upload(path, b, { contentType: b.type, upsert: false });
    if (up.error) { toast('Not saved · ' + up.error.message); setState('review'); return; }
    const body = text.trim() || 'Voice note';
    const { error } = await sb().from('comments').insert({ asset_id: assetId, version_id: versionId, body, at_sec: at.current, audio_path: path, audio_sec: Math.max(0.1, Math.round(sec * 10) / 10) });
    if (error) { toast('Not saved · ' + error.message); setState('review'); return; }
    toast('Voice note added'); discard();
  };

  if (!supported) return null;
  if (state === 'idle') return <button type="button" className="btn" onClick={start} aria-label="Record a voice note">● Record voice note</button>;
  if (state === 'rec') return <div className="row" role="status">
    <span className="recdot" aria-hidden="true" /> <b>Recording {fmtSec(sec)}</b>{at.current != null ? <span className="muted">at {fmtSec(at.current)}</span> : null}
    <button type="button" className="btn primary" onClick={stop}>Stop</button>
    {text ? <div className="muted" style={{ flexBasis: '100%' }}>{text}</div> : null}
  </div>;
  return <div className="panel" style={{ gap: 8 }}>
    <div className="row"><b>Voice note</b><span className="muted">{fmtSec(sec)}{at.current != null ? ' · at ' + fmtSec(at.current) : ''}</span></div>
    {url ? <audio controls src={url} style={{ width: '100%' }} /> : null}
    <label className="sr" htmlFor="vn-text">Transcript</label>
    <textarea id="vn-text" rows={2} placeholder="Transcript (optional)" value={text} onChange={e => setText(e.target.value)} />
    <div className="row"><button type="button" className="btn primary" disabled={state === 'saving'} onClick={save}>{state === 'saving' ? 'Saving' : 'Post voice note'}</button>
      <button type="button" className="btn" disabled={state === 'saving'} onClick={discard}>Discard</button></div>
  </div>;
}
