import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/lib/supabase/server';
import { dateInZone, presetRange, validateRange } from '@/lib/performance/model';
import { loadMetaPerformance, MetaReportingError } from '@/lib/server/meta-reporting';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const member = await currentMember();
    if (!member || !['viewer','creator','approver','admin'].includes(member.role)) return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers });
    const token = process.env.META_ACCESS_TOKEN;
    const accountId = (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
    const version = process.env.META_API_VERSION;
    const configured = !!token && !!accountId && !!version;
    const today = dateInZone(new Date(), process.env.META_ACCOUNT_TIMEZONE || 'America/Vancouver');
    if (req.nextUrl.searchParams.get('status') === '1') return NextResponse.json({ configured, today, accountId: accountId || null }, { headers });
    if (!configured) return NextResponse.json({ error: 'not_connected', message: 'Meta reporting is not connected yet. An administrator needs to configure the server’s reporting credential, account ID and API version.', today }, { status: 503, headers });
    const query = req.nextUrl.searchParams; const defaults = presetRange('30', today);
    const range = { from: query.get('from') || defaults.from, to: query.get('to') || defaults.to };
    try { validateRange(range, today); } catch (e) { return NextResponse.json({ error: 'invalid_range', message: (e as Error).message }, { status: 400, headers }); }
    // Fixed server account. Clients cannot choose another account or submit provider URLs/tokens.
    const data = await loadMetaPerformance({ token: token!, accountId, version: version! }, range, query.get('campaign'));
    return NextResponse.json(data, { headers });
  } catch (e) {
    if (e instanceof MetaReportingError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status, headers });
    return NextResponse.json({ error: 'unavailable', message: 'Account reporting is unavailable. Please try again.' }, { status: 503, headers });
  }
}
