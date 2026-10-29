-- Personal API tokens for each member's own Claude. A token acts as exactly that member (never admin unless the
-- member is an admin), is shown once, stored only as a SHA-256 hash, and can be revoked. The app's API verifies the
-- token server-side, then calls the same permission-checked functions the app uses, passing the member as p_actor.
create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.members(user_id) on delete cascade,
  label text not null check (length(label) between 1 and 80),
  token_hash text not null unique,
  prefix text not null,                     -- first characters, to recognise a token in the list
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.api_tokens enable row level security;
revoke all on public.api_tokens from anon;
revoke insert, update, delete on public.api_tokens from authenticated;
create policy api_tokens_own on public.api_tokens for select to authenticated using (user_id = auth.uid());

-- Signed-in member creates a token for themselves. Plaintext is returned once.
create or replace function public.api_token_create(p_label text)
  returns table(id uuid, token text, prefix text) language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t text; tid uuid;
begin
  if uid is null or app_private.role_rank(app_private.role_of(uid)) < app_private.role_rank('creator') then
    raise exception 'only signed-in members can create tokens' using errcode = '42501';
  end if;
  if (select count(*) from public.api_tokens a where a.user_id = uid and a.revoked_at is null) >= 5 then
    raise exception 'revoke an old token first (limit 5)' using errcode = 'P0001';
  end if;
  t := 'yas_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.api_tokens(user_id, label, token_hash, prefix)
  values (uid, left(coalesce(nullif(btrim(p_label), ''), 'Claude'), 80), encode(sha256(convert_to(t, 'UTF8')), 'hex'), left(t, 10))
  returning api_tokens.id into tid;
  return query select tid, t, left(t, 10);
end $$;

create or replace function public.api_token_revoke(p_id uuid) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  update public.api_tokens set revoked_at = now() where id = p_id and user_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'token not found' using errcode = 'P0002'; end if;
end $$;

-- Server only: hash -> member. Revoked tokens and removed members resolve to nothing.
create or replace function public.api_token_resolve(p_hash text)
  returns table(user_id uuid, role text, email text, display_name text) language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_server() then raise exception 'server only' using errcode = '42501'; end if;
  update public.api_tokens set last_used_at = now() where token_hash = p_hash and revoked_at is null;
  return query select m.user_id, m.role, m.email, m.display_name
    from public.api_tokens a join public.members m on m.user_id = a.user_id
    where a.token_hash = p_hash and a.revoked_at is null;
end $$;

revoke all on function public.api_token_create(text), public.api_token_revoke(uuid), public.api_token_resolve(text) from public, anon;
grant execute on function public.api_token_create(text), public.api_token_revoke(uuid) to authenticated;
grant execute on function public.api_token_resolve(text) to service_role;

-- Retried saves must not create duplicate versions: one version per (asset, idempotency key).
create unique index versions_idempotency on public.versions(asset_id, (source->>'idempotency_key')) where source ? 'idempotency_key';

-- Revert copies the media of an older version but not its save key or review link (those belong to the original save).
create or replace function public.revert_asset(p_asset text, p_from_version text, p_expected_latest text, p_actor uuid default null)
  returns public.versions language plpgsql security definer set search_path = '' as $$
declare uid uuid := app_private.actor(p_actor); src public.versions; nv public.versions;
begin
  if uid is null or not app_private.can_manage_as(uid, p_asset) then raise exception 'only the owner or an admin can revert' using errcode = '42501'; end if;
  select * into src from public.versions where id = p_from_version and asset_id = p_asset;
  if src.id is null then raise exception 'version % not found on %', p_from_version, p_asset using errcode = 'P0002'; end if;
  insert into public.versions(id, asset_id, version, parent_version_id, revision_note, file_path, poster_path, content_type, width, height,
    duration_sec, size_bytes, sha256, source, render, spec, copy, qa, created_by)
  values ('pending', p_asset, 0, p_expected_latest, 'Reverted to v' || src.version, src.file_path, src.poster_path, src.content_type, src.width, src.height,
    src.duration_sec, src.size_bytes, src.sha256, (src.source - 'idempotency_key' - 'processing_id') || jsonb_build_object('reverted_from', src.id),
    src.render, src.spec, src.copy, src.qa, uid)
  returning * into nv;
  return nv;
end $$;

-- Slack review threads -> version-pinned library comments.
-- Server-only tables (written by the app's Slack endpoint after verifying Slack's signature).

-- Where a comment came from, with a link back. Slack edits/deletes keep history instead of losing it.
alter table public.comments
  add column source text not null default 'app' check (source in ('app','claude','slack')),
  add column source_ref text,           -- slack: "<channel>:<ts>"
  add column source_link text,
  add column edited_at timestamptz,
  add column deleted_at timestamptz,
  add column body_history jsonb not null default '[]';
create unique index comments_source_ref on public.comments(source_ref) where source_ref is not null;

-- Clients may not forge Slack provenance or rewrite history.
create or replace function app_private.comments_source_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if app_private.is_server() then return new; end if;
  if tg_op = 'INSERT' then
    new.source := 'app'; new.source_ref := null; new.source_link := null; new.edited_at := null; new.deleted_at := null; new.body_history := '[]';
  elsif (new.source, new.source_ref, new.source_link, new.edited_at, new.deleted_at, new.body_history)
        is distinct from (old.source, old.source_ref, old.source_link, old.edited_at, old.deleted_at, old.body_history) then
    raise exception 'comment provenance is server-owned' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger comments_source_guarded before insert or update on public.comments
  for each row execute function app_private.comments_source_guard();

-- One row per Slack post of an exact version. Save and delivery are separate: retrying a post never re-saves the asset.
create table public.slack_posts (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null references public.assets(id),
  version_id text not null references public.versions(id),
  channel_id text not null,
  channel_name text,
  question text check (question is null or length(question) <= 500),
  posted_by uuid references public.members(user_id),
  idempotency_key text not null unique,
  state text not null default 'pending' check (state in ('pending','sent','failed')),
  ts text,                              -- Slack message ts = thread root
  permalink text,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, ts)
);

-- Verified Slack identity -> member (matched by the email Slack reports for the user, never by display name).
create table public.slack_users (
  slack_user_id text primary key,
  team_id text,
  member_id uuid references public.members(user_id),
  email text,
  checked_at timestamptz not null default now()
);

-- Reactions are sentiment on the shared version. They never approve anything.
create table public.slack_reactions (
  channel_id text not null,
  message_ts text not null,
  slack_user_id text not null,
  reaction text not null,
  member_id uuid references public.members(user_id),
  asset_id text not null references public.assets(id),
  version_id text not null references public.versions(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (channel_id, message_ts, slack_user_id, reaction)
);

-- Slack retries events; each event id is processed once.
create table public.slack_events (
  event_id text primary key,
  type text,
  outcome text,
  received_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['slack_posts','slack_users','slack_reactions','slack_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;
-- Members can see where versions were posted and the sentiment on them; identity mapping and the event log stay server-only.
create policy slack_posts_read on public.slack_posts for select to authenticated using (app_private.role_at_least('viewer'));
create policy slack_reactions_read on public.slack_reactions for select to authenticated using (app_private.role_at_least('viewer'));

-- @supabase-only (storage/realtime; skipped by the PGlite tests)
-- Supabase-only: editable sources can be stored next to the media; processing/Slack rows stream live to the app.
update storage.buckets
   set allowed_mime_types = array['image/png','image/jpeg','image/webp','video/mp4','video/quicktime','video/webm',
                                  'audio/webm','audio/mp4','audio/ogg','audio/mpeg',
                                  'application/json','application/zip','image/svg+xml','text/html','text/plain']
 where id = 'ad-assets';
alter publication supabase_realtime add table public.processing, public.slack_posts, public.slack_reactions;
