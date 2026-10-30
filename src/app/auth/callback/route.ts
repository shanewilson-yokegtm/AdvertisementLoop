import { NextResponse, type NextRequest } from 'next/server';
import { userClient } from '@/lib/supabase/server';

// Magic-link landing: exchange the one-time code for a session cookie.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');
  // Same-origin paths only (query kept, e.g. /oauth/consent?authorization_id=...). Backslashes count as slashes in URLs.
  const target = next && /^\/(?![\/\\])/.test(next) && !/[\\\u0000-\u001f]/.test(next) ? new URL(next, url.origin) : null;
  const dest = target && target.origin === url.origin ? target.pathname + target.search : '/';
  if (code) {
    const s = await userClient();
    const { error } = await s.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(dest, url.origin));
  }
  return NextResponse.redirect(new URL('/login?error=link', url.origin));
}
