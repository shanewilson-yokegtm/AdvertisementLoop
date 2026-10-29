import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/** Acts as the signed-in user (RLS applies). */
export async function userClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* read-only in server components */ } },
    },
  });
}

/** Server-only. Used for writes the database reserves for the server (assistant messages). */
export function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The signed-in member, or null. */
export async function currentMember() {
  const s = await userClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return null;
  const { data: m } = await s.from('members').select('user_id,email,display_name,role').eq('user_id', user.id).maybeSingle();
  return m ? { ...m, client: s } : null;
}
