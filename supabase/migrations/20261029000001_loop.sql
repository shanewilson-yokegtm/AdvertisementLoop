-- Yoke Ad Studio -- the creative loop: idea -> branded ad -> shared Library -> feedback -> next version.
-- Nothing here touches Rumi or Yoke production systems.
--
-- Rules the database enforces (not just the UI):
--   * only signed-in @yokegtm.com users (or emails in role_grants) become members; everyone else sees nothing
--   * every actor column is the signed-in user (auth.uid()); clients cannot write someone else's name
--   * version numbers are assigned by the server under a row lock: two people iterating at once
--     get v3 and v4, never two v3s; versions are immutable once written
--   * chat messages, shares, events and review history are append-only
--   * approve / request changes is approver-only

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to anon, authenticated, service_role;

-- ---------- people ----------
create table public.role_grants (           -- pre-assigned roles by email (admin-managed)
  email text primary key check (email = lower(email)),
  role text not null check (role in ('viewer','creator','approver','admin'))
);
create table public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  role text not null default 'creator' check (role in ('viewer','creator','approver','admin')),
  created_at timestamptz not null default now()
);

create or replace function app_private.app_role() returns text
  language sql stable security definer set search_path = '' as $$
  select coalesce((select m.role from public.members m where m.user_id = auth.uid()), 'none')
$$;
create or replace function app_private.role_at_least(min text) returns boolean
  language sql stable set search_path = '' as $$
  select coalesce(array_position(array['none','viewer','creator','approver','admin'], app_private.app_role())
      >= array_position(array['none','viewer','creator','approver','admin'], min), false)
$$;
-- "Server" = a request with the service-role JWT, or a direct database session with no API JWT
-- (migrations, SQL editor). Read from the request, not current_user, so it stays correct inside
-- SECURITY DEFINER functions.
create or replace function app_private.is_server() returns boolean
  language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                  case when nullif(current_setting('request.jwt.claim.sub', true), '') is null then 'service_role' else 'authenticated' end)
         = 'service_role'
$$;
revoke all on function app_private.app_role() from public;
revoke all on function app_private.role_at_least(text) from public;
revoke all on function app_private.is_server() from public;
grant execute on function app_private.app_role() to anon, authenticated, service_role;
grant execute on function app_private.role_at_least(text) to anon, authenticated, service_role;
grant execute on function app_private.is_server() to anon, authenticated, service_role;

-- New auth user -> member, only for the Yoke domain or a pre-granted email.
create or replace function app_private.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare em text := lower(coalesce(new.email, '')); g text;
begin
  select r.role into g from public.role_grants r where r.email = em;
  if g is null and split_part(em, '@', 2) <> 'yokegtm.com' then return new; end if;
  insert into public.members(user_id, email, display_name, role)
  values (new.id, em, coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), initcap(replace(split_part(em, '@', 1), '.', ' '))), coalesce(g, 'creator'))
  on conflict (user_id) do nothing;
  return new;
end $$;
revoke all on function app_private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

-- Brand rules applied behind the scenes (no Brand tab). One row.
create table public.brand_pack (
  id int primary key default 1 check (id = 1),
  pack jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- Library ----------
create table public.assets (
  id text primary key default ('ast_' || replace(gen_random_uuid()::text, '-', '')),
  concept_name text not null,
  kind text not null check (kind in ('static','motion','video')),
  format text not null,
  archived boolean not null default false,
  archived_note text,
  chat_id uuid,
  latest_version int not null default 0,
  created_by uuid references public.members(user_id),
  legacy_creator text,                       -- imported records: who made it in the old studio
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.versions (
  id text primary key,
  asset_id text not null references public.assets(id),
  version int not null,
  parent_version_id text references public.versions(id),
  revision_note text,
  file_path text,                            -- storage object in bucket ad-assets; null = pending (e.g. waiting on Higgsfield)
  poster_path text,
  content_type text,
  width int, height int,
  duration_sec numeric,
  size_bytes bigint,
  sha256 text,
  source jsonb not null default '{}',        -- tool, model, editable-source link, prompt, chat id
  render jsonb not null default '{"state":"ready"}',   -- ready | rendering | pending (+ label, note)
  spec jsonb,                                -- design spec used to iterate
  copy jsonb not null default '{}',
  qa jsonb not null default '[]',
  created_by uuid references public.members(user_id),
  legacy_creator text,
  created_at timestamptz not null default now(),
  unique (asset_id, version),
  check (file_path is not null or (render->>'state') in ('pending','rendering'))
);

-- Version numbers come from the server, under a lock on the asset row.
create or replace function app_private.versions_number() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not app_private.is_server() then new.created_by := auth.uid(); new.legacy_creator := null; end if;
  update public.assets set latest_version = latest_version + 1, updated_at = now()
    where id = new.asset_id returning latest_version into n;
  if n is null then raise exception 'asset % not found', new.asset_id using errcode = 'P0001'; end if;
  new.version := n;
  new.id := new.asset_id || '_v' || n;
  if new.parent_version_id is null and n > 1 then new.parent_version_id := new.asset_id || '_v' || (n - 1); end if;
  new.created_at := now();
  return new;
end $$;
create trigger versions_numbered before insert on public.versions
  for each row execute function app_private.versions_number();

create or replace function app_private.forbid_mutation() returns trigger
  language plpgsql set search_path = '' as $$
begin raise exception '% is append-only', tg_table_name using errcode = 'P0001'; end $$;
create trigger versions_immutable before update or delete on public.versions
  for each row execute function app_private.forbid_mutation();

-- Users may rename or archive an asset; counters and authorship are server-owned.
create or replace function app_private.assets_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if app_private.is_server() then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.legacy_creator := null; new.latest_version := 0;
    new.created_at := now(); new.updated_at := now();
    return new;
  end if;
  -- the version-numbering trigger (nested, depth > 1) may move only the counter
  if pg_trigger_depth() > 1 and (to_jsonb(new) - 'latest_version' - 'updated_at') = (to_jsonb(old) - 'latest_version' - 'updated_at') then
    return new;
  end if;
  if new.id <> old.id or new.latest_version <> old.latest_version or new.created_by is distinct from old.created_by
     or new.legacy_creator is distinct from old.legacy_creator or new.created_at <> old.created_at or new.kind <> old.kind then
    raise exception 'only name, archive state and chat link can change' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger assets_guarded before insert or update on public.assets
  for each row execute function app_private.assets_guard();

-- ---------- review & feedback ----------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null references public.assets(id),
  version_id text not null references public.versions(id),
  author uuid references public.members(user_id) default auth.uid(),
  legacy_author text,
  body text not null check (length(body) between 1 and 4000),
  at_sec numeric,
  status text not null default 'open' check (status in ('open','applied','dismissed')),
  applied_in text references public.versions(id),
  created_at timestamptz not null default now()
);
create or replace function app_private.comments_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if app_private.is_server() then return new; end if;
  if tg_op = 'INSERT' then new.author := auth.uid(); new.legacy_author := null; new.created_at := now(); new.status := 'open'; return new; end if;
  if (to_jsonb(new) - 'status' - 'applied_in') <> (to_jsonb(old) - 'status' - 'applied_in') then
    raise exception 'only comment status can change' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger comments_guarded before insert or update on public.comments
  for each row execute function app_private.comments_guard();

create table public.reviews (
  version_id text primary key references public.versions(id),
  status text not null check (status in ('approved','changes')),
  note text,
  reviewer uuid references public.members(user_id),
  at timestamptz not null default now()
);
create table public.review_history (
  id bigint generated always as identity primary key,
  version_id text not null,
  status text not null, note text, reviewer uuid, at timestamptz not null
);
create or replace function app_private.reviews_stamp() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_server() then new.reviewer := auth.uid(); end if;
  new.at := now();
  insert into public.review_history(version_id, status, note, reviewer, at) values (new.version_id, new.status, new.note, new.reviewer, new.at);
  return new;
end $$;
create trigger reviews_stamped before insert or update on public.reviews
  for each row execute function app_private.reviews_stamp();
create trigger review_history_append_only before update or delete on public.review_history
  for each row execute function app_private.forbid_mutation();

create table public.shares (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null references public.assets(id),
  version_id text not null references public.versions(id),
  channel text,                              -- e.g. #creative-review, or 'link' for copy-message shares
  note text,
  link text,
  shared_by uuid references public.members(user_id) default auth.uid(),
  at timestamptz not null default now()
);

-- ---------- Create an ad: one conversation per ad ----------
create table public.chats (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  create_type text not null default 'static' check (create_type in ('static','motion','higgsfield')),
  asset_id text references public.assets(id),
  created_by uuid references public.members(user_id) default auth.uid(),
  last_by uuid references public.members(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id),
  role text not null check (role in ('user','assistant')),
  body text not null default '',
  create_type text check (create_type in ('static','motion','higgsfield')),
  asset_refs jsonb not null default '[]',    -- [{asset_id, version_id}]
  error text,
  blocked text,                              -- e.g. higgsfield_not_connected
  author uuid references public.members(user_id),   -- who sent it (user) or who asked (assistant)
  at timestamptz not null default now()
);
create or replace function app_private.chat_messages_stamp() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_server() then
    if new.role <> 'user' then raise exception 'only the server writes assistant messages' using errcode = 'P0001'; end if;
    new.author := auth.uid();
  end if;
  new.at := now();
  update public.chats set updated_at = now(), last_by = coalesce(new.author, last_by) where id = new.chat_id;
  return new;
end $$;
create trigger chat_messages_stamped before insert on public.chat_messages
  for each row execute function app_private.chat_messages_stamp();
create trigger chat_messages_append_only before update or delete on public.chat_messages
  for each row execute function app_private.forbid_mutation();

-- ---------- feedback utility ----------
create table public.feedback (
  id text primary key,                       -- made when the form opens; resubmits are no-ops
  type text not null check (type in ('bug','suggestion')),
  body text not null check (length(body) between 1 and 4000),
  test boolean not null default false,
  context jsonb not null default '{}',
  error_details jsonb,
  screenshot_path text,
  submitted_by uuid references public.members(user_id) default auth.uid(),
  submitted_at timestamptz not null default now(),
  delivery jsonb not null default '{"claude":{"state":"pending"},"slack":{"state":"pending"}}'
);

create table public.events (
  id bigint generated always as identity primary key,
  actor uuid default auth.uid(), action text not null, target text, detail text,
  at timestamptz not null default now()
);
create trigger events_append_only before update or delete on public.events
  for each row execute function app_private.forbid_mutation();
create trigger shares_append_only before update or delete on public.shares
  for each row execute function app_private.forbid_mutation();

-- ---------- row level security ----------
do $$ declare t text; begin
  foreach t in array array['role_grants','members','brand_pack','assets','versions','comments','reviews','review_history',
    'shares','chats','chat_messages','feedback','events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_private.role_at_least(''viewer''))', t||'_read', t);
  end loop;
end $$;

create policy assets_ins on public.assets for insert to authenticated with check (app_private.role_at_least('creator'));
create policy assets_upd on public.assets for update to authenticated using (app_private.role_at_least('creator')) with check (app_private.role_at_least('creator'));
create policy versions_ins on public.versions for insert to authenticated with check (app_private.role_at_least('creator'));
create policy comments_ins on public.comments for insert to authenticated with check (app_private.role_at_least('creator'));
create policy comments_upd on public.comments for update to authenticated using (app_private.role_at_least('creator')) with check (app_private.role_at_least('creator'));
create policy reviews_ins on public.reviews for insert to authenticated with check (app_private.role_at_least('approver'));
create policy reviews_upd on public.reviews for update to authenticated using (app_private.role_at_least('approver')) with check (app_private.role_at_least('approver'));
create policy shares_ins on public.shares for insert to authenticated with check (app_private.role_at_least('creator') and shared_by = auth.uid());
create policy chats_ins on public.chats for insert to authenticated with check (app_private.role_at_least('creator') and created_by = auth.uid());
create policy chats_upd on public.chats for update to authenticated using (app_private.role_at_least('creator')) with check (app_private.role_at_least('creator'));
create policy chat_messages_ins on public.chat_messages for insert to authenticated with check (app_private.role_at_least('creator'));
create policy feedback_ins on public.feedback for insert to authenticated with check (app_private.role_at_least('viewer') and submitted_by = auth.uid());
create policy events_ins on public.events for insert to authenticated with check (app_private.role_at_least('creator') and actor = auth.uid());
create policy members_admin on public.members for update to authenticated using (app_private.role_at_least('admin')) with check (app_private.role_at_least('admin'));
create policy role_grants_admin on public.role_grants for all to authenticated using (app_private.role_at_least('admin')) with check (app_private.role_at_least('admin'));
create policy brand_pack_admin on public.brand_pack for all to authenticated using (app_private.role_at_least('admin')) with check (app_private.role_at_least('admin'));

-- Nothing is readable or writable without signing in.
revoke all on all tables in schema public from anon;
