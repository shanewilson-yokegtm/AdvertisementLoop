import { NextResponse } from 'next/server';
import { currentMember, serviceClient } from '@/lib/supabase/server';

// Posts a review request to a Slack channel through the Yoke Slack app (SLACK_BOT_TOKEN).
// The bot only posts where it has been invited. Without a token this returns 503 and the UI offers Copy message.
export async function POST(req: Request) {
  const m = await currentMember();
  if (!m || !['creator', 'approver', 'admin'].includes(m.role)) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'slack_not_connected' }, { status: 503 });
  const { assetId, versionId, channel, note, origin } = await req.json();
  if (typeof channel !== 'string' || !/^#?[a-z0-9_.-]{1,80}$/i.test(channel)) return NextResponse.json({ error: 'Bad channel name' }, { status: 400 });
  const { data: v } = await m.client.from('versions').select('id,version,asset_id,assets(concept_name,kind,format)').eq('id', versionId).eq('asset_id', assetId).maybeSingle();
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const a: any = (v as any).assets;
  const base = typeof origin === 'string' && /^https:\/\/[\w.-]+$/.test(origin) ? origin : '';
  const text = `*${a.concept_name}* · v${v.version} -- for review, shared by ${m.display_name}` + (note ? `\n> ${String(note).slice(0, 1000).replace(/\n/g, '\n> ')}` : '') + (base ? `\n${base}/a/${assetId}` : '');
  const r = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ channel: channel.replace(/^#/, ''), text }) });
  const j = await r.json();
  if (!j.ok) return NextResponse.json({ error: j.error === 'not_in_channel' || j.error === 'channel_not_found' ? `The Yoke Slack app isn't in ${channel}. Invite it there first.` : `Slack: ${j.error}` }, { status: 502 });
  let link: string | null = null;
  try { const p = await fetch(`https://slack.com/api/chat.getPermalink?channel=${j.channel}&message_ts=${j.ts}`, { headers: { authorization: `Bearer ${token}` } }).then(x => x.json()); link = p.permalink || null; } catch { /* ok */ }
  await serviceClient().from('shares').insert({ asset_id: assetId, version_id: versionId, channel, note: note || null, link, shared_by: m.user_id });
  return NextResponse.json({ ok: true, link });
}
