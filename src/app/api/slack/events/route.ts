import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';
import { handleSlackEvent, slackApi, verifySlackSignature } from '@/lib/server/slack';

export const dynamic = 'force-dynamic';

// Slack Events API endpoint. Every request is signature-checked before anything is read or written.
export async function POST(req: NextRequest) {
  const secret = process.env.SLACK_SIGNING_SECRET; const token = process.env.SLACK_BOT_TOKEN;
  if (!secret || !token || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'slack_not_enabled' }, { status: 503 });
  const raw = await req.text();
  if (!verifySlackSignature(raw, req.headers.get('x-slack-request-timestamp'), req.headers.get('x-slack-signature'), secret)) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  }
  let payload: any; try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  if (payload.type === 'url_verification') return NextResponse.json({ challenge: payload.challenge });
  const outcome = await handleSlackEvent(serviceClient(), slackApi(token), payload, process.env.APP_URL || req.nextUrl.origin);
  return NextResponse.json({ ok: true, outcome });
}
