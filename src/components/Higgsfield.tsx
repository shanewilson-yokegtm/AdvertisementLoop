'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const MIN = 4, MAX = 12, DEFAULT = 9;
const FORMAT_KEYS = ['vertical', 'feed45', 'square', 'landscape'] as const;
const LABEL: Record<string, string> = { vertical: 'Vertical · 9:16', feed45: 'Feed · 3:4 (closest to 4:5)', square: 'Square · 1:1', landscape: 'Landscape · 16:9' };

/** Is Higgsfield switched on on the server? (HF_CREDENTIALS present; the key itself never reaches the browser.) */
export function useHiggsfieldOn() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { fetch('/api/health').then(r => r.json()).then(j => setOn(!!j?.configured?.higgsfield)).catch(() => setOn(false)); }, []);
  return on;
}

type Usage = { seconds_this_month: number; generations_this_month: number; monthly_cap_seconds: number | null };

/** Seedance 2.5 · 720p · 4-12 s (default 9) · sound toggle. One press = one billable request (idempotent on retry). */
export function HiggsfieldForm({ assetId, conceptName, initialPrompt = '', chatId, disabled, toast }: {
  assetId?: string | null; conceptName?: string; initialPrompt?: string; chatId?: string | null; disabled?: boolean; toast: (m: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(conceptName || '');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [secs, setSecs] = useState(DEFAULT);
  const [format, setFormat] = useState<string>('vertical');
  const [audio, setAudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [use, setUse] = useState<Usage | null>(null);
  const key = useRef<string>(crypto.randomUUID());
  useEffect(() => { setPrompt(p => p || initialPrompt); }, [initialPrompt]);
  useEffect(() => { fetch('/api/higgsfield/usage').then(r => r.ok ? r.json() : null).then(setUse).catch(() => {}); }, []);
  // Any change to the request makes it a new request.
  useEffect(() => { key.current = crypto.randomUUID(); }, [prompt, secs, format, audio, name]);

  const over = !!use?.monthly_cap_seconds && use.seconds_this_month + secs > use.monthly_cap_seconds;
  return <form className="hf" aria-label="Higgsfield video" onSubmit={async e => {
    e.preventDefault(); if (busy || disabled || !prompt.trim() || over) return; setBusy(true);
    try {
      const r = await fetch('/api/higgsfield/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({ asset_id: assetId || null, concept_name: name.trim() || undefined, prompt: prompt.trim(), duration: secs, format: assetId ? undefined : format, audio, idempotency_key: key.current, chat_id: chatId || null }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.message || 'Couldn’t start the render'); if (r.status !== 504) key.current = crypto.randomUUID(); return; }
      toast(j.repeated ? 'Already rendering · opening it' : 'Rendering in Higgsfield · it appears in the Library in a few minutes');
      router.push(`/a/${j.asset_id}?v=${j.version_id}`);
    } catch { toast('No answer from the server. Press Generate again: the same request is reused, so you won’t pay twice.'); }
    finally { setBusy(false); }
  }}>
    {!assetId ? <label className="f">Name<input value={name} onChange={e => setName(e.target.value)} placeholder="Ad name (optional)" maxLength={70} /></label> : null}
    <label className="f">What happens in the video?<textarea rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={4000}
      placeholder="Handheld shot of a GTM engineer at a desk at night, three spreadsheets open, sighs, closes the laptop. Warm lamp light." /></label>
    <div className="hfrow">
      {!assetId ? <label className="f">Format<select value={format} onChange={e => setFormat(e.target.value)}>
        {FORMAT_KEYS.map(k => <option key={k} value={k}>{LABEL[k]}</option>)}</select></label> : null}
      <label className="f">Length · {secs}s<input type="range" min={MIN} max={MAX} step={1} value={secs} onChange={e => setSecs(Number(e.target.value))} aria-valuetext={`${secs} seconds`} /></label>
      <label className="toggle"><input type="checkbox" role="switch" checked={audio} onChange={e => setAudio(e.target.checked)} /> Sound</label>
    </div>
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="muted" role="status">Seedance 2.5 · 720p · uses Higgsfield credits{use ? ` · ${use.seconds_this_month}s made this month${use.monthly_cap_seconds ? ` of ${use.monthly_cap_seconds}s` : ''}` : ''}{over ? ' · over this month’s budget' : ''}</span>
      <button className="btn primary" disabled={busy || disabled || !prompt.trim() || over}>{busy ? 'Starting…' : `Generate ${secs}s video`}</button>
    </div>
  </form>;
}

/** On an asset page: while a version is rendering in Higgsfield, check every 10 s and reload when it finishes. */
export function useHiggsfieldPoll(jobId: string | null, onDone: () => void) {
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/higgsfield/status?job=${jobId}`); const j = await r.json().catch(() => ({}));
        if (j.status && j.status !== 'submitted' && j.status !== 'submitting') { stop = true; onDone(); return; }
      } catch { /* try again */ }
      if (!stop) t = setTimeout(tick, 10_000);
    };
    let t = setTimeout(tick, 3_000);
    return () => { stop = true; clearTimeout(t); };
  }, [jobId]); // eslint-disable-line
}
