-- Higgsfield generations. A generation creates a "Rendering" version right away; when Higgsfield finishes, the server
-- fills in that same version exactly once (real file, or a clear failed state). Every other version stays immutable.
create table public.higgsfield_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null references public.assets(id),
  version_id text not null references public.versions(id),
  requested_by uuid not null references public.members(user_id),
  idempotency_key text not null unique,
  model text not null default 'bytedance/seedance-2.5/text-to-video',
  prompt text not null check (length(prompt) between 1 and 4000),
  duration int not null check (duration between 4 and 12),
  aspect_ratio text not null check (aspect_ratio in ('9:16','3:4','1:1','16:9')),
  resolution text not null default '720p' check (resolution in ('720p')),
  audio boolean not null default false,
  request_id text unique,
  status text not null default 'submitting' check (status in ('submitting','submitted','completed','failed','nsfw','error')),
  result_url text,
  error text check (error is null or length(error) <= 1000),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.higgsfield_jobs enable row level security;
revoke all on public.higgsfield_jobs from anon;
revoke insert, update, delete on public.higgsfield_jobs from authenticated;
create policy higgsfield_jobs_read on public.higgsfield_jobs for select to authenticated using (app_private.role_at_least('viewer'));

-- A render that failed has no file; it stays in history with its reason.
alter table public.versions drop constraint versions_check;
alter table public.versions add constraint versions_check check (file_path is not null or (render->>'state') in ('pending','rendering','failed'));

-- Versions stay append-only, except: the server may finish a still-rendering version once.
create or replace function app_private.versions_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and app_private.is_server()
     and old.file_path is null and (old.render->>'state') in ('pending','rendering')
     and (new.file_path is not null or (new.render->>'state') = 'failed')
     and (to_jsonb(new) - 'file_path' - 'poster_path' - 'content_type' - 'width' - 'height' - 'duration_sec' - 'size_bytes' - 'sha256' - 'render' - 'source')
       = (to_jsonb(old) - 'file_path' - 'poster_path' - 'content_type' - 'width' - 'height' - 'duration_sec' - 'size_bytes' - 'sha256' - 'render' - 'source') then
    return new;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $$;
drop trigger versions_immutable on public.versions;
create trigger versions_immutable before update or delete on public.versions
  for each row execute function app_private.versions_guard();
