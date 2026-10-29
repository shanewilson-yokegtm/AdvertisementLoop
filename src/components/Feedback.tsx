'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { sb } from '@/lib/supabase/browser';
import { useApp } from './Shell';

const BUILD = 'advertisementloop web 0.2';
let lastErr: { message: string; where: string; at: string } | null = null;
if (typeof window !== 'undefined') {
  addEventListener('error', e => { lastErr = { message: String(e.message || 'Error').slice(0, 200), where: `${(e.filename || '').split('/').pop()}:${e.lineno || '?'}`.slice(0, 80), at: new Date().toISOString() }; });
  addEventListener('unhandledrejection', e => { const r: any = e.reason || {}; lastErr = { message: String(r.message || r).slice(0, 200), where: 'promise', at: new Date().toISOString() }; });
}

export default function Feedback() {
  const { member, toast } = useApp();
  const path = usePathname();
  const [open, setOpen] = useState(false); const [type, setType] = useState<'bug' | 'suggestion'>('bug');
  const [text, setText] = useState(''); const [test, setTest] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const id = useRef('');
  useEffect(() => { if (open) id.current = 'fb_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16); }, [open]);
  const ctx = { screen: path, build: BUILD, viewport: typeof window !== 'undefined' ? `${innerWidth}×${innerHeight}` : '' };
  if (!member) return null;
  return <>
    <button className="fbfab" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>Suggest · Report bug</button>
    {open ? <div className="modal" role="dialog" aria-modal="true" aria-labelledby="fbT" onKeyDown={e => e.key === 'Escape' && setOpen(false)}>
      <form className="box" onSubmit={async e => {
        e.preventDefault(); if (!text.trim()) { setErr('Add a description'); return; }
        setBusy(true); setErr('');
        const { error } = await sb().from('feedback').insert({ id: id.current, type, body: text.trim().slice(0, 4000), test, context: ctx, error_details: type === 'bug' ? lastErr : null, submitted_by: member.user_id });
        setBusy(false);
        if (error && !/duplicate key/.test(error.message)) { setErr('Not saved · ' + error.message + ' · your text is kept'); return; }
        setOpen(false); setText(''); setTest(false); toast('Thanks · saved for Shane');
      }}>
        <div className="head" style={{ margin: 0 }}><h2 id="fbT">Feedback</h2><button className="btn" type="button" onClick={() => setOpen(false)}>Close</button></div>
        <div className="seg" role="radiogroup" aria-label="Type">
          {(['bug', 'suggestion'] as const).map(t => <label key={t}><input type="radio" name="fbType" checked={type === t} onChange={() => setType(t)} /><span>{t === 'bug' ? 'Report a bug' : 'Make a suggestion'}</span></label>)}
        </div>
        <label className="f">What happened, or what would help?<textarea rows={6} maxLength={4000} value={text} onChange={e => setText(e.target.value)} autoFocus /></label>
        <div><h3 style={{ marginBottom: 6 }}>Sent with it</h3>
          <dl className="ctx"><dt>Screen</dt><dd>{ctx.screen}</dd><dt>Build</dt><dd>{ctx.build}</dd><dt>Screen size</dt><dd>{ctx.viewport}</dd><dt>You</dt><dd>{member.display_name}</dd>
            {type === 'bug' && lastErr ? <><dt>Last error</dt><dd>{lastErr.message} ({lastErr.where})</dd></> : null}</dl></div>
        <label className="row"><input type="checkbox" checked={test} onChange={e => setTest(e.target.checked)} /> Test submission</label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>{err ? <span className="muted" role="alert">{err}</span> : null}<button className="btn primary" disabled={busy}>Send</button></div>
      </form>
    </div> : null}
  </>;
}
