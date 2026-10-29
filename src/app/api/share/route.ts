import { NextResponse } from 'next/server';
import { currentMember, serviceClient } from '@/lib/supabase/server';
import { shareVersion, slackApi } from '@/lib/server/slack';

export const dynamic = 'force-dynamic';

// Share an exact version to a Slack channel the user picked. Requires the Yoke Slack app (bot token) and the server key.
export async function POST(req: Request) {
  const m = await currentMember();
  if (!m) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'slack_not_connected' }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const r = await shareVersion(serviceClient(), slackApi(token), m as any, { asset_id: b.assetId, version_id: b.versionId, channel_id: b.channelId, question: b.question, idempotency_key: b.idempotencyKey }, process.env.APP_URL || new URL(req.url).origin);
  return NextResponse.json(r.body, { status: r.status });
}
