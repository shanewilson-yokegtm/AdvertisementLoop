-- Request changes -> revision job. A scheduled Claude worker claims queued jobs, makes the next
-- version from the spoken/typed feedback, adds it to the Library and records the result here.
create table public.revision_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null references public.assets(id),
  version_id text not null references public.versions(id),
  note text,
  requested_by uuid references public.members(user_id),
  state text not null default 'queued' check (state in ('queued','working','done','needs_input','failed')),
  claimed_at timestamptz,
  session_url text,
  result_version_id text references public.versions(id),
  message text check (message is null or length(message) <= 1000),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index revision_jobs_open on public.revision_jobs(state, created_at) where state in ('queued','working');
alter table public.revision_jobs enable row level security;
revoke all on public.revision_jobs from anon;
create policy revision_jobs_read on public.revision_jobs for select to authenticated using (app_private.role_at_least('viewer'));
-- No client writes: jobs come from the reviews trigger; only the server (worker) updates them.

create or replace function app_private.reviews_queue_revision() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare v_asset text; v_open uuid;
begin
  if new.status <> 'changes' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'changes' and old.note is not distinct from new.note then return new; end if;
  select asset_id into v_asset from public.versions where id = new.version_id;
  select id into v_open from public.revision_jobs where version_id = new.version_id and state = 'queued' limit 1;
  if v_open is not null then
    update public.revision_jobs set note = concat_ws(E'\n\n', note, new.note), updated_at = now() where id = v_open;
  else
    insert into public.revision_jobs(asset_id, version_id, note, requested_by) values (v_asset, new.version_id, new.note, new.reviewer);
  end if;
  return new;
end $$;
revoke all on function app_private.reviews_queue_revision() from public, anon, authenticated;
create trigger reviews_queue_revision after insert or update on public.reviews
  for each row execute function app_private.reviews_queue_revision();

alter publication supabase_realtime add table public.revision_jobs;
