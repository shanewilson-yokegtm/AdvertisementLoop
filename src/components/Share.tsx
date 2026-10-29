'use client';
import { useEffect, useMemo, useState } from 'react';
import { sb } from '@/lib/supabase/browser';
import { canManage, FORMATS, KIND_LABEL, type Asset, type Version } from '@/lib/data';
import { useApp } from './Shell';
import { assetVersionPath } from '@/lib/creative-loop';

export function shareText(a: Asset, v: Version, note: string) {
  const url = `${location.origin}${assetVersionPath(a.id, v.id)}`;
  return `*${a.concept_name}* · v${v.version} · ${KIND_LABEL[a.kind]} ${FORMATS[a.format]?.label || a.format} -- for review` + (note ? `\n> ${note.replace(/\n/g, '\n> ')}` : '') + `\n${url}`;
}

type Channel = { id: string; name: string; is_private?: boolean };

/** Share this exact version. Slack: the owner picks a channel the Yoke app is in; replies come back as feedback on this version. */
export default function Share({ a, v, onClose }: { a: Asset; v: Version; onClose: () => void }) {
  const { member, toast } = useApp();
  const owner = canManage(member, a);
  const [channels, setChannels] = useState<Channel[] | null>(null); const [slackOff, setSlackOff] = useState<string | null>(null);
  const [channelId, setChannelId] = useState(''); const [question, setQuestion] = useState('');
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  // One key per dialog: retrying after an error can never post the same version twice.
  const key = useMemo(() => `share_${v.id}_${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`, [v.id]);
  useEffect(() => {
    if (!owner) return;
    fetch('/api/slack/channels').then(async r => {
      const j = await r.json().catch(() => ({}));
      if (r.status === 503) setSlackOff('Slack isn’t connected to Ad Studio yet.');
      else if (!r.ok) setSlackOff(j.error || 'Couldn’t load Slack channels.');
      else setChannels(j.channels || []);
    }).catch(() => setSlackOff('Couldn’t load Slack channels.'));
  }, [owner]);
  const record = (ch: string | null, link: string | null) => sb().from('shares').insert({ asset_id: a.id, version_id: v.id, channel: ch, note: question.trim() || null, link, shared_by: member!.user_id });

  return <div className="modal" role="dialog" aria-modal="true" aria-labelledby="shT">
    <form className="box" onSubmit={async e => {
      e.preventDefault(); if (!channelId) { setMsg('Pick a channel'); return; }
      setBusy(true); setMsg('Posting');
      const r = await fetch('/api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: a.id, versionId: v.id, channelId, question: question.trim() || null, idempotencyKey: key }) });
      const j = await r.json().catch(() => ({}));
      setBusy(false);
      if (!r.ok) { setMsg(j.message || j.error || 'Slack post failed · try again'); return; }
      const name = channels?.find(c => c.id === channelId)?.name;
      toast(`Posted v${v.version} to #${name || 'channel'} · replies come back here`); onClose();
    }}>
      <div className="head" style={{ margin: 0 }}><h2 id="shT">Share for review</h2><button type="button" className="btn" onClick={onClose}>Close</button></div>
      <div><b>{a.concept_name}</b> <span className="muted">v{v.version}</span></div>
      {owner ? (slackOff ? <p className="muted">{slackOff} Use Copy message for now.</p>
        : <>
          <label className="f">Slack channel
            <select value={channelId} onChange={e => setChannelId(e.target.value)} disabled={!channels}>
              <option value="">{channels ? (channels.length ? 'Pick a channel' : 'Invite the Yoke app to a channel first') : 'Loading channels'}</option>
              {(channels || []).map(c => <option key={c.id} value={c.id}>{c.is_private ? '🔒 ' : '#'}{c.name}</option>)}
            </select></label>
          <label className="f">Question (optional)<textarea rows={2} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Is the hook too much?" /></label>
        </>) : <p className="muted">Only the owner can post this ad to Slack. You can copy a link or leave a comment.</p>}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(shareText(a, v, question.trim())); await record(null, `${location.origin}${assetVersionPath(a.id, v.id)}`); toast('Copied · paste it anywhere'); } catch { setMsg('Copy blocked · select the text manually'); } }}>Copy message</button>
        <div className="row"><span className="muted" role="status">{msg}</span>{owner && !slackOff ? <button className="btn primary" disabled={busy || !channelId}>Post to Slack</button> : null}</div>
      </div>
    </form></div>;
}
