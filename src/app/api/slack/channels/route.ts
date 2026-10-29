import { NextResponse } from 'next/server';
import { currentMember } from '@/lib/supabase/server';
import { slackApi } from '@/lib/server/slack';

export const dynamic = 'force-dynamic';

// Channels the Yoke Slack app has been invited to. The user picks one explicitly; nothing is chosen for them.
export async function GET() {
  const m = await currentMember();
  if (!m) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'slack_not_connected', channels: [] }, { status: 503 });
  const r = await slackApi(token)('users.conversations', { types: 'public_channel,private_channel', exclude_archived: true, limit: 200 });
  if (!r?.ok) return NextResponse.json({ error: `slack: ${r?.error || 'error'}`, channels: [] }, { status: 502 });
  return NextResponse.json({ channels: (r.channels || []).map((c: any) => ({ id: c.id, name: c.name, is_private: !!c.is_private })) });
}
