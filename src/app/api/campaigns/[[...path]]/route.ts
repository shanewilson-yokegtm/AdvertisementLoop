import { NextResponse, type NextRequest } from 'next/server';
import { currentMember, serviceClient } from '@/lib/supabase/server';
import { ApiError, type Actor } from '@/lib/server/api';
import { handleCampaign } from '@/lib/server/campaign-api';

export const dynamic = 'force-dynamic';
async function run(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  try {
    if (req.method !== 'GET' && req.headers.get('origin') !== req.nextUrl.origin)
      return NextResponse.json({ error: 'forbidden', message: 'Same-origin request required' }, { status: 403 });
    const member = await currentMember();
    if (!member) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    let body = null;
    if (req.method !== 'GET') {
      const raw = await req.text();
      if (Buffer.byteLength(raw) > 1_000_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
      try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    }
    const { path = [] } = await ctx.params;
    const data = await handleCampaign(serviceClient(), member as Actor, req.method, path, body, req.nextUrl.searchParams);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    return NextResponse.json({ error: 'unavailable', message: 'Campaign service unavailable. Verify server configuration and apply the campaign migration before use.' }, { status: 503 });
  }
}
export const GET = run;
export const POST = run;
