import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';
import { ApiError, authenticate, handle } from '@/lib/server/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function run(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'api_not_enabled', message: 'The Ad Studio API is not switched on yet (server key missing). Use the manual handoff bundle and upload in the app.' }, { status: 503 });
  }
  try {
    const db = serviceClient();
    const actor = await authenticate(db, req.headers.get('authorization'));
    const { path } = await ctx.params;
    let body: any = null;
    if (req.method !== 'GET') { try { body = await req.json(); } catch { body = {}; } }
    const appUrl = process.env.APP_URL || req.nextUrl.origin;
    const data = await handle(db, actor, req.method, path, body, req.nextUrl.searchParams, appUrl);
    return NextResponse.json(data);
  } catch (e: any) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    return NextResponse.json({ error: 'error', message: 'Unexpected error' }, { status: 500 });
  }
}
export const GET = run;
export const POST = run;
