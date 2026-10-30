-- Regenerate ad for Higgsfield videos, and frozen feedback for every regenerate.
-- 1. When the owner presses Regenerate, the approved items are frozen (id, text, author, version, time, Slack link).
--    Later edits or deletions in Slack never change what was approved; the worker and Higgsfield both use the snapshot.
-- 2. Higgsfield revisions run in the app server, not the scheduled worker: one paid render on the exact reviewed
--    version, same length/aspect/sound, idempotent per processing row. Feedback becomes applied only after the
--    playable MP4 and its version are stored (processing_complete), never on submit.

alter table public.processing add column feedback_snapshot jsonb not null default '[]';
alter table public.processing add column engine text not null default 'worker' check (engine in ('worker', 'higgsfield'));
alter table public.higgsfield_jobs add column processing_id uuid references public.processing(id);
alter table public.higgsfield_jobs add column parent_version_id text references public.versions(id);
create unique index higgsfield_jobs_one_per_processing on public.higgsfield_jobs(processing_id) where processing_id is not null;

create or replace function app_private.feedback_snapshot(p_ids uuid[]) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'comment_id', c.id, 'version_id', c.version_id, 'author', c.author,
    'author_name', coalesce(m.display_name, c.legacy_author, 'Teammate'), 'body', c.body, 'at_sec', c.at_sec,
    'audio_path', c.audio_path, 'source', c.source, 'source_link', c.source_link, 'created_at', c.created_at, 'edited_at', c.edited_at
  ) order by c.created_at), '[]'::jsonb)
  from public.comments c left join public.members m on m.user_id = c.author
  where c.id = any(p_ids)
$$;
revoke all on function app_private.feedback_snapshot(uuid[]) from public, anon, authenticated;

-- Same behaviour as before, plus the frozen snapshot.
create or replace function public.feedback_process(p_asset text, p_note text default null, p_actor uuid default null)
  returns public.processing language plpgsql security definer set search_path = '' as $$
declare uid uuid := app_private.actor(p_actor); p public.processing; latest text; ids uuid[];
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not app_private.can_manage_as(uid, p_asset) then raise exception 'only the owner or an admin can process feedback' using errcode = '42501'; end if;
  perform 1 from public.assets where id = p_asset for update;
  if exists (select 1 from public.processing where asset_id = p_asset and status in ('approved','executing')) then
    raise exception 'a new version is already being made; approved feedback will go into the one after' using errcode = 'P0001';
  end if;
  update public.processing set status = 'cancelled', updated_at = now(), rev = rev + 1, message = 'Replaced by Process approved feedback'
    where asset_id = p_asset and status = 'reviewing';
  select coalesce(array_agg(c.id order by c.created_at), '{}') into ids from public.comments c
    where c.asset_id = p_asset and c.status = 'open' and c.decision = 'approved' and c.deleted_at is null;
  if cardinality(ids) = 0 and coalesce(btrim(p_note), '') = '' then
    raise exception 'approve at least one piece of feedback first' using errcode = '22023';
  end if;
  select a.id || '_v' || a.latest_version into latest from public.assets a where a.id = p_asset;
  insert into public.processing(asset_id, reviewed_version_id, comment_ids, processor, started_by, started_via, status, decisions, instructions, history, feedback_snapshot)
  values (p_asset, latest, ids, uid, uid, 'app', 'approved',
    coalesce((select jsonb_agg(jsonb_build_object('comment_id', x, 'decision', 'apply')) from unnest(ids) x), '[]'),
    nullif(btrim(p_note), ''),
    jsonb_build_array(jsonb_build_object('at', now(), 'by', uid, 'event', 'approved', 'detail', jsonb_build_object('apply', cardinality(ids)))),
    app_private.feedback_snapshot(ids))
  returning * into p;
  update public.reviews set status = 'changes', reviewer = uid, note = 'Reopened: approved feedback is going into the next version'
    where version_id = latest and status = 'approved';
  insert into public.revision_jobs(asset_id, version_id, note, requested_by, processing_id) values (p_asset, latest, p.instructions, uid, p.id);
  return p;
end $$;

-- Higgsfield regenerate, step 1 (server only). Returns the existing row on a repeated press for the same asset.
create or replace function public.higgsfield_revision_start(p_asset text, p_note text default null, p_actor uuid default null)
  returns public.processing language plpgsql security definer set search_path = '' as $$
declare uid uuid := app_private.actor(p_actor); p public.processing; latest public.versions; ids uuid[];
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not app_private.can_manage_as(uid, p_asset) then raise exception 'only the owner or an admin can regenerate this ad' using errcode = '42501'; end if;
  if app_private.role_rank(app_private.role_of(uid)) < app_private.role_rank('creator') then raise exception 'creators only' using errcode = '42501'; end if;
  perform 1 from public.assets where id = p_asset and not archived for update;
  if not found then raise exception 'ad not found or archived' using errcode = 'P0002'; end if;
  select * into p from public.processing where asset_id = p_asset and status in ('approved','executing') order by created_at desc limit 1;
  if p.id is not null then
    if p.engine = 'higgsfield' then return p; end if;
    raise exception 'a new version is already being made; approved feedback will go into the one after' using errcode = 'P0001';
  end if;
  -- Parent = newest finished version. Failed render placeholders are skipped (they stay in history);
  -- a render still in progress blocks a new one.
  if exists (select 1 from public.versions v where v.asset_id = p_asset and v.file_path is null and v.render->>'state' in ('pending','rendering')
             and v.version > coalesce((select max(x.version) from public.versions x where x.asset_id = p_asset and x.file_path is not null), 0)) then
    raise exception 'a render is still in progress for this ad' using errcode = 'P0001';
  end if;
  select v.* into latest from public.versions v where v.asset_id = p_asset and v.file_path is not null order by v.version desc limit 1;
  if latest.id is null or coalesce(latest.render->>'state', 'ready') <> 'ready' or latest.spec->>'type' is distinct from 'higgsfield' then
    raise exception 'regenerate with Higgsfield needs a finished Higgsfield video as the latest version' using errcode = '22023';
  end if;
  update public.processing set status = 'cancelled', updated_at = now(), rev = rev + 1, message = 'Replaced by Regenerate ad'
    where asset_id = p_asset and status = 'reviewing';
  select coalesce(array_agg(c.id order by c.created_at), '{}') into ids from public.comments c
    where c.asset_id = p_asset and c.status = 'open' and c.decision = 'approved' and c.deleted_at is null;
  if cardinality(ids) = 0 and coalesce(btrim(p_note), '') = '' then
    raise exception 'approve at least one piece of feedback first' using errcode = '22023';
  end if;
  insert into public.processing(asset_id, reviewed_version_id, comment_ids, processor, started_by, started_via, status, engine, decisions, instructions, history, feedback_snapshot)
  values (p_asset, latest.id, ids, uid, uid, 'app', 'executing', 'higgsfield',
    coalesce((select jsonb_agg(jsonb_build_object('comment_id', x, 'decision', 'apply')) from unnest(ids) x), '[]'),
    nullif(left(btrim(p_note), 2000), ''),
    jsonb_build_array(jsonb_build_object('at', now(), 'by', uid, 'event', 'executing', 'detail', jsonb_build_object('apply', cardinality(ids), 'engine', 'higgsfield'))),
    app_private.feedback_snapshot(ids))
  returning * into p;
  update public.reviews set status = 'changes', reviewer = uid, note = 'Reopened: approved feedback is going into the next version'
    where version_id = latest.id and status = 'approved';
  return p;
end $$;
revoke all on function public.higgsfield_revision_start(text, text, uuid) from public, anon, authenticated;
grant execute on function public.higgsfield_revision_start(text, text, uuid) to service_role;

-- A failed render leaves an empty "failed" placeholder as the newest version. A retry should build on the last real
-- version, so a named parent may be older than the latest only when every newer version is a failed placeholder.
-- Any newer real or still-rendering version is still a conflict (someone saved first).
create or replace function app_private.versions_number() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare n int; latest text;
begin
  if not app_private.is_server() then new.created_by := auth.uid(); new.legacy_creator := null; end if;
  select a.id || '_v' || a.latest_version into latest from public.assets a where a.id = new.asset_id for update;
  if latest is null then raise exception 'asset % not found', new.asset_id using errcode = 'P0001'; end if;
  if new.parent_version_id is not null and new.parent_version_id <> latest and (
       not exists (select 1 from public.versions p where p.id = new.parent_version_id and p.asset_id = new.asset_id and p.file_path is not null)
       or exists (select 1 from public.versions x where x.asset_id = new.asset_id
                    and x.version > (select p.version from public.versions p where p.id = new.parent_version_id)
                    and not (x.file_path is null and x.render->>'state' = 'failed'))) then
    raise exception 'stale_parent: % is no longer the latest version (latest is %)', new.parent_version_id, latest using errcode = 'P0001';
  end if;
  update public.assets set latest_version = latest_version + 1, updated_at = now()
    where id = new.asset_id returning latest_version into n;
  new.version := n;
  new.id := new.asset_id || '_v' || n;
  if new.parent_version_id is null and n > 1 then new.parent_version_id := new.asset_id || '_v' || (n - 1); end if;
  new.created_at := now();
  return new;
end $$;
