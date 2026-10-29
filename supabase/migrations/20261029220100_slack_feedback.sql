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
