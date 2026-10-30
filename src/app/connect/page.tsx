'use client';
import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { useRows, fmtDate } from '@/lib/data';
import { useApp } from '@/components/Shell';

type Token = { id: string; label: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
type Grant = { client: { id: string; name: string }; scopes: string[]; granted_at: string };

// The connector is on only when Shane has registered the OAuth client (public, so no secret) and set these values.
const CLIENT_ID = (process.env.NEXT_PUBLIC_MCP_OAUTH_CLIENT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0] || '';

export default function Connect() {
  const { toast } = useApp();
  const tokens = useRows<Token>('api_tokens', { order: 'created_at' });
  const [label, setLabel] = useState('My scripts'); const [fresh, setFresh] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const origin = typeof window !== 'undefined' ? location.origin : '';
  const mcpUrl = `${origin}/api/mcp`; const api = `${origin}/api/v1`;
  const loadGrants = () => { if (!CLIENT_ID) return; sb().auth.oauth.listGrants().then(({ data, error }) => setGrants(error ? [] : ((data || []) as Grant[]))); };
  useEffect(loadGrants, []);
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Select and copy it manually'); } };
  const mine = (grants || []).filter(g => g.client.id === CLIENT_ID);

  return <div style={{ maxWidth: 720 }} className="section">
    <div className="head" style={{ marginBottom: 0 }}><h1>Connect Claude</h1></div>
    <p className="muted" style={{ margin: 0 }}>Make ads in Claude and have them land here, as you, with your permissions and nothing more.</p>

    {CLIENT_ID ? <section className="panel" aria-labelledby="cc">
      <h2 id="cc">Claude chat, Cowork and desktop</h2>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li>In Claude, open <b>Customize › Connectors</b>. If Yoke Ad Studio is listed (your workspace Owner added it), press <b>Connect</b> and skip to step 3.</li>
        <li>Otherwise choose <b>Add custom connector</b>. Name it <b>Yoke Ad Studio</b> and use:
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>Server URL</dt><dd className="row"><code className="mono">{mcpUrl}</code><button type="button" className="btn small" onClick={() => copy(mcpUrl)}>Copy</button></dd>
            <dt>OAuth client</dt><dd>Use your own OAuth client</dd>
            <dt>Client ID</dt><dd className="row"><code className="mono">{CLIENT_ID}</code><button type="button" className="btn small" onClick={() => copy(CLIENT_ID)}>Copy</button></dd>
            <dt>Client secret</dt><dd>Leave blank</dd>
          </dl></li>
        <li>Sign in with your Yoke email and press <b>Allow</b>. You’ll see exactly what it can do first.</li>
        <li>Keep <b>Generate Higgsfield video</b> and <b>Post to Slack</b> on <b>Ask</b> in the connector’s tool permissions. They also ask you in chat every time.</li>
      </ol>
      <div className="section" style={{ gap: 6 }}>
        <h3>Connected</h3>
        {grants === null ? <span className="muted">Checking</span> : !mine.length ? <span className="muted">Not connected yet.</span>
          : mine.map(g => <div key={g.client.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span><b>{g.client.name || 'Claude'}</b> <span className="muted">· allowed {fmtDate(g.granted_at)}</span></span>
            <button className="btn small quiet-danger" onClick={async () => { const { error } = await sb().auth.oauth.revokeGrant({ clientId: g.client.id }); toast(error ? error.message : 'Disconnected'); loadGrants(); }}>Disconnect</button>
          </div>)}
      </div>
    </section> : <div className="banner info" role="status">The Claude connector isn’t switched on yet. Until it is, make ads in the app, or use a personal token below if you run Claude Code.</div>}

    <details className="disc">
      <summary>Advanced: personal token for Claude Code and scripts</summary>
      <div className="inner">
        <p className="hint">Only for tools that keep secrets in their own environment, like Claude Code or your terminal. Never paste a token into a chat, doc or shared connector.</p>
        <form className="row" onSubmit={async e => {
          e.preventDefault(); setBusy(true);
          const { data, error } = await sb().rpc('api_token_create', { p_label: label });
          setBusy(false);
          if (error) { toast('Not created · ' + error.message); return; }
          setFresh((data as any[])[0].token); tokens.reload();
        }}>
          <label className="sr" htmlFor="tl">Label</label><input id="tl" value={label} onChange={e => setLabel(e.target.value)} maxLength={80} style={{ flex: 1 }} />
          <button className="btn" disabled={busy}>Create token</button>
        </form>
        {fresh ? <div className="banner" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
          <b>Copy it now. It won’t be shown again.</b>
          <code className="mono" style={{ wordBreak: 'break-all' }}>{fresh}</code>
          <div className="row"><button className="btn small" onClick={() => copy(fresh)}>Copy</button><button className="btn small" onClick={() => setFresh(null)}>Done</button></div>
          <span className="muted">Set it as <code>AD_STUDIO_TOKEN</code> in that tool’s secret settings. <code>AD_STUDIO_API</code> defaults to {api}.</span>
        </div> : null}
        {!tokens.rows.length ? <p className="hint">No tokens.</p> : tokens.rows.map(t => <div key={t.id} className="row" style={{ justifyContent: 'space-between' }}>
          <span><b>{t.label}</b> <span className="mono muted">{t.prefix}…</span> <span className="muted">· made {fmtDate(t.created_at)} · {t.last_used_at ? 'used ' + fmtDate(t.last_used_at) : 'not used yet'}</span></span>
          {t.revoked_at ? <span className="chip plain">Revoked</span> : <button className="btn small quiet-danger" onClick={async () => { const { error } = await sb().rpc('api_token_revoke', { p_id: t.id }); toast(error ? error.message : 'Revoked'); tokens.reload(); }}>Revoke</button>}
        </div>)}
      </div>
    </details>
  </div>;
}
