-- Account-based Claude connector (remote MCP over Supabase's OAuth 2.1 server).
-- OAuth access tokens are ordinary Supabase JWTs plus a client_id claim, so on their own they could reach the
-- Data API, Storage and Realtime as the user. The connector must be MCP-only: every database path refuses a
-- token that carries client_id, and the MCP endpoint re-checks permissions through the existing API rules.
-- Applying this migration does NOT enable the OAuth server, register a client or turn the hook on.

-- 1. One place that recognises a connector (OAuth client) token. Works under PostgREST and Storage, which both
--    publish the verified claims as request.jwt.claims.
create or replace function app_private.oauth_client_id() returns text
  language sql stable set search_path = '' as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '')
$$;
revoke all on function app_private.oauth_client_id() from public;
grant execute on function app_private.oauth_client_id() to anon, authenticated, service_role;

-- 2. PostgREST pre-request check: refuses every table, view and RPC call made with a connector token.
--    (Wired up below, Supabase only.)
create or replace function app_private.deny_oauth_data_api() returns void
  language plpgsql stable set search_path = '' as $$
begin
  if app_private.oauth_client_id() is not null then
    raise exception 'Claude connector tokens only work with the Ad Studio MCP endpoint'
      using errcode = '42501', hint = 'Use the Ad Studio connector in Claude, or sign in to the app.';
  end if;
end $$;
revoke all on function app_private.deny_oauth_data_api() from public;
grant execute on function app_private.deny_oauth_data_api() to anon, authenticated, service_role;

-- 3. Defence in depth: a RESTRICTIVE policy on every public table (and Storage objects). Restrictive policies are
--    ANDed with the existing ones, so app sessions keep exactly their current access; connector tokens get none.
--    Realtime evaluates the same RLS, so subscriptions are covered too.
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('drop policy if exists no_oauth_connector on public.%I', t.relname);
    execute format('create policy no_oauth_connector on public.%I as restrictive for all to anon, authenticated using (app_private.oauth_client_id() is null) with check (app_private.oauth_client_id() is null)', t.relname);
  end loop;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists no_oauth_connector on storage.objects';
    execute 'create policy no_oauth_connector on storage.objects as restrictive for all to anon, authenticated using (app_private.oauth_client_id() is null) with check (app_private.oauth_client_id() is null)';
  end if;
end $$;

-- New tables must get the same guard. Fail loudly in tests if one is ever missing it (see mcp.test.mjs).

-- 4. Audience binding. Supabase issues OAuth access tokens with aud = "authenticated". This Custom Access Token Hook
--    (enabled by Shane in Auth > Hooks, not by this migration) rewrites aud for connector tokens only:
--      registered connector client -> aud = the MCP resource URL (the only audience /api/mcp accepts)
--      any other OAuth client      -> aud = "unregistered-oauth-client" (accepted nowhere)
--    Browser sessions (no client_id) are returned unchanged.
create table if not exists app_private.mcp_oauth_config (
  id boolean primary key default true check (id),
  resource text not null,
  client_ids text[] not null default '{}'
);
insert into app_private.mcp_oauth_config (resource) values ('https://advertisementloop-eight.vercel.app/api/mcp') on conflict (id) do nothing;
revoke all on app_private.mcp_oauth_config from public, anon, authenticated;

create or replace function public.mcp_access_token_hook(event jsonb) returns jsonb
  language plpgsql stable set search_path = '' as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  cid text := coalesce(nullif(event ->> 'client_id', ''), nullif(claims ->> 'client_id', ''));
  cfg app_private.mcp_oauth_config;
begin
  if cid is null then return event; end if;
  select * into cfg from app_private.mcp_oauth_config where id;
  if cfg.resource is not null and cid = any(cfg.client_ids) then
    claims := jsonb_set(claims, '{aud}', to_jsonb(cfg.resource));
  else
    claims := jsonb_set(claims, '{aud}', '"unregistered-oauth-client"'::jsonb);
  end if;
  return jsonb_set(event, '{claims}', claims);
end $$;
revoke all on function public.mcp_access_token_hook(jsonb) from public, anon, authenticated;

-- 5. Revocation is immediate: the MCP endpoint refuses tokens whose Supabase session no longer exists
--    (Disconnect in Connect Claude, sign-out everywhere, or removal), instead of waiting for the token to expire.
create or replace function public.mcp_session_active(p_session uuid) returns boolean
  language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (select 1 from auth.sessions s where s.id = p_session and (s.not_after is null or s.not_after > now()));
end $$;
revoke all on function public.mcp_session_active(uuid) from public, anon, authenticated;
grant execute on function public.mcp_session_active(uuid) to service_role;

-- @supabase-only
grant usage on schema app_private to supabase_auth_admin;
grant select on app_private.mcp_oauth_config to supabase_auth_admin;
grant execute on function public.mcp_access_token_hook(jsonb) to supabase_auth_admin;
alter role authenticator set pgrst.db_pre_request = 'app_private.deny_oauth_data_api';
notify pgrst, 'reload config';
