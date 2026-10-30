'use client';
import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { useApp, roleLabel } from '@/components/Shell';

// Supabase Auth sends people here (Authorization Path) with ?authorization_id=. The proxy keeps that query through
// sign-in. Only the registered Ad Studio connector can be approved; anything else can only be denied.
const KNOWN = (process.env.NEXT_PUBLIC_MCP_OAUTH_CLIENT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

type Details = { authorization_id: string; redirect_uri: string; scope: string; client: { id: string; name: string; uri: string; logo_uri: string }; user: { id: string; email: string } };

export function Consent({ authorizationId, known = KNOWN, go = (u: string) => location.assign(u) }: { authorizationId: string | null; known?: string[]; go?: (url: string) => void }) {
  const { member } = useApp();
  const [d, setD] = useState<Details | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState<'' | 'approve' | 'deny' | 'redirect'>('');
  useEffect(() => {
    if (!authorizationId) { setErr('This sign-in link is incomplete. Start again from Claude.'); return; }
    sb().auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (error || !data) { setErr(error?.message ? `Couldn’t load this request · ${error.message}` : 'This request expired. Start again from Claude.'); return; }
      if ('redirect_url' in data && !('authorization_id' in data)) { setBusy('redirect'); go(data.redirect_url); return; }
      setD(data as Details);
    });
  }, [authorizationId]);
  const act = async (kind: 'approve' | 'deny') => {
    if (!d) return; setBusy(kind); setErr('');
    const r = kind === 'approve' ? await sb().auth.oauth.approveAuthorization(d.authorization_id, { skipBrowserRedirect: true }) : await sb().auth.oauth.denyAuthorization(d.authorization_id, { skipBrowserRedirect: true });
    const to = (r.data as any)?.redirect_url;
    if (r.error || !to) { setBusy(''); setErr(`Not saved · ${r.error?.message || 'no redirect returned'}`); return; }
    go(to);
  };
  if (err) return <div className="empty" role="alert"><h2>Can’t connect</h2><span className="muted">{err}</span></div>;
  if (busy === 'redirect' || !d) return <div className="empty"><span className="muted">{busy === 'redirect' ? 'Returning to Claude' : 'Loading'}</span></div>;
  const trusted = known.includes(d.client.id);
  let host = d.redirect_uri; try { host = new URL(d.redirect_uri).host; } catch { /* show as-is */ }
  const creator = member && ['creator', 'approver', 'admin'].includes(member.role);
  return <div style={{ maxWidth: 560, margin: '0 auto' }} className="section">
    <h1>Connect {d.client.name || 'an app'} to Ad Studio?</h1>
    {!trusted ? <div className="banner err" role="alert">This isn’t the Ad Studio Claude connector. Only connect apps Shane set up. Deny unless you’re sure.</div> : null}
    <div className="panel">
      <dl className="kv">
        <dt>App</dt><dd>{d.client.name || 'Unnamed app'}{d.client.uri ? <> · <span className="muted">{d.client.uri}</span></> : null}</dd>
        <dt>Returns to</dt><dd className="mono">{host}</dd>
        <dt>As</dt><dd>{member?.display_name || d.user.email} · {roleLabel(member?.role)}</dd>
      </dl>
      <div>
        <h3 style={{ marginBottom: 6 }}>It can, as you</h3>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>Read the library and every ad’s feedback thread, and comment</li>
          {creator ? <><li>Create ads and save versions of ads you own</li><li>Approve or reject feedback on your ads and regenerate them</li></> : null}
          <li>Nothing your role can’t already do in the app</li>
        </ul>
      </div>
      <p className="hint">Paid Higgsfield video and Slack posts still ask you in Claude every time. Final approval stays in the app. You can disconnect any time in Connect Claude.</p>
    </div>
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      <button className="btn" disabled={!!busy} onClick={() => act('deny')}>Deny</button>
      {trusted ? <button className="btn primary" disabled={!!busy} onClick={() => act('approve')}>{busy === 'approve' ? 'Connecting' : 'Allow'}</button> : null}
    </div>
  </div>;
}

