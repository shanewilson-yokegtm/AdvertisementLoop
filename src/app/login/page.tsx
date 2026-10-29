'use client';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { sb } from '@/lib/supabase/browser';

const DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN || 'yokegtm.com';

function Login() {
  const params = useSearchParams();
  const [email, setEmail] = useState(''); const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle'); const [err, setErr] = useState('');
  const next = params.get('next') || '/';
  return (
    <div className="center wrap"><form className="auth panel" onSubmit={async e => {
      e.preventDefault(); const em = email.trim().toLowerCase();
      if (!em.endsWith('@' + DOMAIN)) { setState('error'); setErr(`Use your @${DOMAIN} email`); return; }
      setState('sending');
      const { error } = await sb().auth.signInWithOtp({ email: em, options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
      if (error) { setState('error'); setErr(error.message); } else setState('sent');
    }}>
      <h1>Yoke Ad Studio</h1>
      {params.get('error') ? <div className="banner err">That sign-in link expired or was already used. Send a new one.</div> : null}
      {state === 'sent' ? <div className="banner">Check {email} for a sign-in link.</div> : <>
        <label className="f">Work email<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={`you@${DOMAIN}`} /></label>
        <button className="btn primary" disabled={state === 'sending'}>{state === 'sending' ? 'Sending' : 'Email me a sign-in link'}</button>
        {state === 'error' ? <div className="muted" role="alert">{err}</div> : null}
      </>}
    </form></div>
  );
}
export default function Page() { return <Suspense><Login /></Suspense>; }
