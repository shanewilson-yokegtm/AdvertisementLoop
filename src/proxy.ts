import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refreshes the Supabase session cookie and sends signed-out visitors to /login.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const p = request.nextUrl.pathname;
  // /api/v1 and /api/slack authenticate per request (personal token / Slack signature), not with the browser session.
  const open = p.startsWith('/login') || p.startsWith('/auth') || p === '/api/health' || p.startsWith('/api/v1/') || p.startsWith('/api/slack/') || p === '/api/higgsfield/webhook';
  if (!user && !open) {
    if (p.startsWith('/api/')) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
    const url = request.nextUrl.clone(); url.pathname = '/login'; url.search = p === '/' ? '' : `?next=${encodeURIComponent(p)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp|ico)$).*)'] };
