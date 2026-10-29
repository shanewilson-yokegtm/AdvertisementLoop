-- Ownership, owner/admin permissions, shared feedback processing, inboxes, revert, conflict-safe saves.
--
-- Rules (enforced here, for the app, the Claude API and background jobs alike):
--   * every asset has an owner (the creator); ownership is stable through revisions; only an admin can reassign it
--   * only the owner or an admin may add versions, revert, archive/reject/rename, resolve feedback, upload into the
--     asset's folder, or read/write its processing records and working chats
--   * every member may read every shared asset and its full comment thread, and add attributed comments
--   * final approval stays with approvers/admins (unchanged)
--   * a version that names a parent must be built on the current latest version (no silent overwrite)
--   * Request changes records feedback for the owner; it no longer starts an edit by itself

-- ---------- actor resolution ----------
-- Signed-in calls act as auth.uid(); p_actor is ignored for them. Only a server call (service role, used by the
-- app's API after verifying a personal token, or a background job) may act for a named member.
create or replace function app_private.actor(p_actor uuid) returns uuid
  language sql stable set search_path = '' as $$
  select case when auth.uid() is not null then auth.uid()
              when app_private.is_server() then p_actor
              else null end
$$;
create or replace function app_private.role_of(p_uid uuid) returns text
  language sql stable security definer set search_path = '' as $$
  select coalesce((select m.role from public.members m where m.user_id = p_uid), 'none')
$$;
create or replace function app_private.role_rank(r text) returns int
  language sql immutable set search_path = '' as $$
  select coalesce(array_position(array['none','viewer','creator','approver','admin'], r), 1)
$$;

-- ---------- ownership ----------
alter table public.assets add column owner_id uuid references public.members(user_id);
-- Every existing asset was made in Shane's sessions (imports, Claude renders) or by its recorded creator.
update public.assets a set owner_id = coalesce(a.created_by, (select user_id from public.members where email = 'shane.wilson@yokegtm.com'));

create or replace function app_private.can_manage_as(p_uid uuid, p_asset text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select p_uid is not null and (
    app_private.role_of(p_uid) = 'admin'
    or (app_private.role_rank(app_private.role_of(p_uid)) >= app_private.role_rank('creator')
        and exists (select 1 from public.assets a where a.id = p_asset and a.owner_id = p_uid)))
$$;
create or replace function app_private.can_manage(p_asset text) returns boolean
  language sql stable set search_path = '' as $$
  select app_private.is_server() or app_private.can_manage_as(auth.uid(), p_asset)
$$;
revoke all on function app_private.actor(uuid), app_private.role_of(uuid), app_private.role_rank(text),
  app_private.can_manage_as(uuid, text), app_private.can_manage(text) from public;
grant execute on function app_private.actor(uuid), app_private.role_of(uuid), app_private.role_rank(text),
  app_private.can_manage_as(uuid, text), app_private.can_manage(text) to authenticated, service_role;

create or replace function app_private.assets_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if app_private.is_server() then
    if tg_op = 'INSERT' then new.owner_id := coalesce(new.owner_id, new.created_by); end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.owner_id := auth.uid(); new.legacy_creator := null; new.latest_version := 0;
    new.created_at := now(); new.updated_at := now();
    return new;
  end if;
  if pg_trigger_depth() > 1 and (to_jsonb(new) - 'latest_version' - 'updated_at') = (to_jsonb(old) - 'latest_version' - 'updated_at') then
    return new;
  end if;
  if new.id <> old.id or new.latest_version <> old.latest_version or new.created_by is distinct from old.created_by
     or new.legacy_creator is distinct from old.legacy_creator or new.created_at <> old.created_at or new.kind <> old.kind then
    raise exception 'only name, archive state and chat link can change' using errcode = 'P0001';
  end if;
  if new.owner_id is distinct from old.owner_id and app_private.role_of(auth.uid()) <> 'admin' then
    raise exception 'only an admin can change the owner' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop policy assets_upd on public.assets;
create policy assets_upd on public.assets for update to authenticated
  using (app_private.can_manage(id)) with check (app_private.can_manage(id));

-- ---------- versions: owner/admin only, conflict-safe ----------
drop policy versions_ins on public.versions;
create policy versions_ins on public.versions for insert to authenticated
  with check (app_private.role_at_least('creator') and app_private.can_manage(asset_id));

create or replace function app_private.versions_number() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare n int; latest text;
begin
  if not app_private.is_server() then new.created_by := auth.uid(); new.legacy_creator := null; end if;
  -- lock the asset row; a named parent must still be the latest version (otherwise someone saved first)
  select a.id || '_v' || a.latest_version into latest from public.assets a where a.id = new.asset_id for update;
  if latest is null then raise exception 'asset % not found', new.asset_id using errcode = 'P0001'; end if;
  if new.parent_version_id is not null and new.parent_version_id <> latest then
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

-- ---------- comments: anyone comments, owner/admin resolves ----------
alter table public.comments add column resolution_note text check (resolution_note is null or length(resolution_note) <= 1000),
  add column resolved_by uuid references public.members(user_id),
  add column resolved_at timestamptz;

create or replace function app_private.comments_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.versions v where v.id = new.version_id and v.asset_id = new.asset_id) then
      raise exception 'version % does not belong to asset %', new.version_id, new.asset_id using errcode = 'P0001';
    end if;
    if app_private.is_server() then return new; end if;
    new.author := auth.uid(); new.legacy_author := null; new.created_at := now(); new.status := 'open';
    new.resolution_note := null; new.resolved_by := null; new.resolved_at := null;
    return new;
  end if;
  if app_private.is_server() then return new; end if;
  if (to_jsonb(new) - 'status' - 'applied_in' - 'resolution_note' - 'resolved_by' - 'resolved_at')
     <> (to_jsonb(old) - 'status' - 'applied_in' - 'resolution_note' - 'resolved_by' - 'resolved_at') then
    raise exception 'only comment status can change' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then new.resolved_by := auth.uid(); new.resolved_at := now(); end if;
  return new;
end $$;

drop policy comments_upd on public.comments;
create policy comments_upd on public.comments for update to authenticated
  using (app_private.can_manage(asset_id)) with check (app_private.can_manage(asset_id));

-- ---------- private working records: chats ----------
drop policy chats_read on public.chats;
drop policy chat_messages_read on public.chat_messages;
drop policy chats_upd on public.chats;
drop policy chats_ins on public.chats;
drop policy chat_messages_ins on public.chat_messages;
create or replace function app_private.can_use_chat(p_chat uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select app_private.is_server() or app_private.role_of(auth.uid()) = 'admin'
      or exists (select 1 from public.chats c where c.id = p_chat and c.created_by = auth.uid())
$$;
revoke all on function app_private.can_use_chat(uuid) from public;
grant execute on function app_private.can_use_chat(uuid) to authenticated, service_role;
create policy chats_read on public.chats for select to authenticated using (app_private.can_use_chat(id));
create policy chats_ins on public.chats for insert to authenticated
  with check (app_private.role_at_least('creator') and created_by = auth.uid() and (asset_id is null or app_private.can_manage(asset_id)));
create policy chats_upd on public.chats for update to authenticated using (app_private.can_use_chat(id)) with check (app_private.can_use_chat(id));
create policy chat_messages_read on public.chat_messages for select to authenticated using (app_private.can_use_chat(chat_id));
create policy chat_messages_ins on public.chat_messages for insert to authenticated
  with check (app_private.role_at_least('creator') and app_private.can_use_chat(chat_id));

-- ---------- revision jobs are private to owner/admin; no more auto-queue from Request changes ----------
drop trigger reviews_queue_revision on public.reviews;
drop policy revision_jobs_read on public.revision_jobs;
create policy revision_jobs_read on public.revision_jobs for select to authenticated using (app_private.can_manage(asset_id));

-- ---------- one shared processing record per feedback review ----------
create table public.processing (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null references public.assets(id),
  reviewed_version_id text not null references public.versions(id),   -- latest version when the review started
  comment_ids uuid[] not null default '{}',                            -- feedback in this review (snapshot)
  processor uuid references public.members(user_id),                  -- who is processing (owner, or admin taking over)
  started_by uuid references public.members(user_id),
  started_via text not null check (started_via in ('app','claude')),
  status text not null default 'reviewing' check (status in ('reviewing','approved','executing','done','failed','cancelled')),
  proposal jsonb not null default '{}',     -- {summary, items:[{comment_ids[], kind: compatible|conflict, change}]}
  decisions jsonb not null default '[]',    -- [{comment_id, decision: apply|defer|dismiss, note}]
  instructions text,                        -- the edits approved for execution
  result_version_id text references public.versions(id),
  message text check (message is null or length(message) <= 2000),
  rev int not null default 0,               -- bumps on every change; callers pass the rev they saw
  history jsonb not null default '[]',      -- [{at, by, event, detail}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index processing_one_active on public.processing(asset_id) where status in ('reviewing','approved','executing');
alter table public.processing enable row level security;
revoke all on public.processing from anon;
create policy processing_read on public.processing for select to authenticated using (app_private.can_manage(asset_id));
-- no direct client writes: all changes go through the functions below
revoke insert, update, delete on public.processing from authenticated;

alter table public.revision_jobs add column processing_id uuid references public.processing(id);

create or replace function app_private.processing_touch(p public.processing, p_by uuid, p_event text, p_detail jsonb)
  returns jsonb language sql stable set search_path = '' as $$
  select p.history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'event', p_event, 'detail', p_detail))
$$;

create or replace function app_private.processing_load(p_id uuid, p_rev int, p_uid uuid) returns public.processing
  language plpgsql security definer set search_path = '' as $$
declare p public.processing;
begin
  if p_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into p from public.processing where id = p_id for update;
  if p.id is null then raise exception 'processing % not found', p_id using errcode = 'P0002'; end if;
  if not app_private.can_manage_as(p_uid, p.asset_id) then raise exception 'only the owner or an admin can process this feedback' using errcode = '42501'; end if;
  if p_rev is not null and p.rev <> p_rev then
    raise exception 'conflict: this review changed (rev % now, you had %); reload it', p.rev, p_rev using errcode = '40001';
  end if;
  return p;
end $$;

-- Start or resume. Resuming by a different authorized person is a takeover: the processor changes, the owner never does.
create or replace function public.processing_start(p_asset text, p_via text default 'app', p_actor uuid default null)
  returns public.processing language plpgsql security definer set search_path = '' as $$
declare uid uuid := app_private.actor(p_actor); p public.processing; latest text; ids uuid[];
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not app_private.can_manage_as(uid, p_asset) then raise exception 'only the owner or an admin can process this feedback' using errcode = '42501'; end if;
  perform 1 from public.assets where id = p_asset for update;
  select * into p from public.processing where asset_id = p_asset and status in ('reviewing','approved','executing');
  if p.id is not null then
    if p.processor is distinct from uid then
      update public.processing set processor = uid, rev = rev + 1, updated_at = now(),
        history = app_private.processing_touch(p, uid, 'takeover', jsonb_build_object('from', p.processor, 'via', p_via))
      where id = p.id returning * into p;
    end if;
    return p;
  end if;
  select a.id || '_v' || a.latest_version into latest from public.assets a where a.id = p_asset;
  select coalesce(array_agg(c.id order by c.created_at), '{}') into ids from public.comments c where c.asset_id = p_asset and c.status = 'open';
  insert into public.processing(asset_id, reviewed_version_id, comment_ids, processor, started_by, started_via, history)
  values (p_asset, latest, ids, uid, uid, p_via, jsonb_build_array(jsonb_build_object('at', now(), 'by', uid, 'event', 'started', 'detail', jsonb_build_object('via', p_via))))
  returning * into p;
  return p;
end $$;

create or replace function public.processing_save_proposal(p_id uuid, p_rev int, p_proposal jsonb, p_actor uuid default null)
  returns public.processing language plpgsql security definer set search_path = '' as $$
declare uid uuid := app_private.actor(p_actor); p public.processing;
begin
  p := app_private.processing_load(p_id, p_rev, uid);
  if p.status <> 'reviewing' then raise exception 'proposal can only change while reviewing (status %)', p.status using errcode = 'P0001'; end if;
  update public.processing set proposal = coalesce(p_proposal, '{}'), processor = uid, rev = rev + 1, updated_at = now(),
    history = app_private.processing_touch(p, uid, 'proposal', '{}') where id = p_id returning * into p;
  return p;
end $$;

-- Approve the selected edits ("Execute changes", or an explicit instruction in Claude). Deferred and undecided items stay pending.
create or replace function public.processing_approve(p_id uuid, p_rev int, p_decisions jsonb, p_instructions text,
  p_queue_worker boolean default true, p_actor uuid default null)
  returns public.processing language plpgsql security definer set search_path = '' as $$
declare uid uuid := app_private.actor(p_actor); p public.processing; d jsonb; n_apply int := 0;
begin
  p := app_private.processing_load(p_id, p_rev, uid);
  if p.status <> 'reviewing' then raise exception 'already % ', p.status using errcode = 'P0001'; end if;
  if jsonb_typeof(p_decisions) <> 'array' then raise exception 'decisions must be a list' using errcode = '22023'; end if;
  for d in select * from jsonb_array_elements(p_decisions) loop
    if not ((d->>'comment_id')::uuid = any(p.comment_ids)) then
      raise exception 'comment % is not part of this review', d->>'comment_id' using errcode = '22023';
    end if;
    if d->>'decision' not in ('apply','defer','dismiss') then raise exception 'unknown decision %', d->>'decision' using errcode = '22023'; end if;
    if d->>'decision' = 'apply' then n_apply := n_apply + 1; end if;
  end loop;
  if n_apply = 0 and coalesce(btrim(p_instructions), '') = '' then
    raise exception 'select at least one change to execute' using errcode = '22023';
  end if;
  update public.processing set decisions = p_decisions, instructions = nullif(btrim(p_instructions), ''), status = 'approved',
    processor = uid, rev = rev + 1, updated_at = now(),
    history = app_private.processing_touch(p, uid, 'approved', jsonb_build_object('apply', n_apply)) where id = p_id returning * into p;
  if p_queue_worker then
    insert into public.revision_jobs(asset_id, version_id, note, requested_by, processing_id)
    values (p.asset_id, p.reviewed_version_id, p.instructions, uid, p.id);
  end if;
  return p;
end $$;

-- Finish: the new version must be built on the reviewed version (no one saved in between). Resolve only what was handled.
create or replace function public.processing_complete(p_id uuid, p_rev int, p_result_version text, p_note text default null, p_actor uuid default null)
  returns public.processing language plpgsql security definer set search_path = '' as $$
declare uid uuid := app_private.actor(p_actor); p public.processing; v public.versions; d jsonb;
begin
  p := app_private.processing_load(p_id, p_rev, uid);
  if p.status not in ('approved','executing') then raise exception 'nothing approved to complete (status %)', p.status using errcode = 'P0001'; end if;
  select * into v from public.versions where id = p_result_version;
  if v.id is null or v.asset_id <> p.asset_id then raise exception 'result version must belong to this asset' using errcode = '22023'; end if;
  if coalesce(v.source->>'processing_id', '') <> p.id::text then
    raise exception 'conflict: % was not produced for this review (set source.processing_id)', v.id using errcode = '40001';
  end if;
  if v.parent_version_id is distinct from p.reviewed_version_id then
    raise exception 'conflict: % was built on %, but this review was of %', v.id, v.parent_version_id, p.reviewed_version_id using errcode = '40001';
  end if;
  for d in select * from jsonb_array_elements(p.decisions) loop
    if d->>'decision' = 'apply' then
      update public.comments set status = 'applied', applied_in = v.id, resolved_by = uid, resolved_at = now(),
        resolution_note = left(d->>'note', 1000) where id = (d->>'comment_id')::uuid and status = 'open';
    elsif d->>'decision' = 'dismiss' then
      update public.comments set status = 'dismissed', resolved_by = uid, resolved_at = now(),
        resolution_note = left(coalesce(d->>'note', 'Dismissed in review'), 1000) where id = (d->>'comment_id')::uuid and status = 'open';
    end if;
  end loop;
  update public.processing set status = 'done', result_version_id = v.id, message = left(p_note, 2000), rev = rev + 1, updated_at = now(),
    history = app_private.processing_touch(p, uid, 'done', jsonb_build_object('version', v.id)) where id = p_id returning * into p;
  update public.revision_jobs set state = 'done', result_version_id = v.id, updated_at = now() where processing_id = p.id and state in ('queued','working');
  return p;
end $$;

create or replace function public.processing_set_status(p_id uuid, p_rev int, p_status text, p_message text default null, p_actor uuid default null)
  returns public.processing language plpgsql security definer set search_path = '' as $$
declare uid uuid := app_private.actor(p_actor); p public.processing;
begin
  p := app_private.processing_load(p_id, p_rev, uid);
  if p_status not in ('executing','failed','cancelled','reviewing') then raise exception 'unsupported status %', p_status using errcode = '22023'; end if;
  if p.status in ('done','cancelled') then raise exception 'review already %', p.status using errcode = 'P0001'; end if;
  -- failed or cancelled work keeps the last valid version and leaves every comment pending
  update public.processing set status = p_status, message = left(p_message, 2000), processor = uid, rev = rev + 1, updated_at = now(),
    history = app_private.processing_touch(p, uid, p_status, jsonb_build_object('message', p_message)) where id = p_id returning * into p;
  if p_status in ('failed','cancelled') then
    update public.revision_jobs set state = case when p_status = 'failed' then 'failed' else 'cancelled' end, message = left(p_message, 1000), updated_at = now()
      where processing_id = p.id and state in ('queued','working');
  end if;
  return p;
end $$;

-- ---------- revert: new version from a historical one, history kept ----------
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
    src.duration_sec, src.size_bytes, src.sha256, src.source || jsonb_build_object('reverted_from', src.id), src.render, src.spec, src.copy, src.qa, uid)
  returning * into nv;
  return nv;
end $$;

-- ---------- inboxes (computed on the server) ----------
create or replace function public.feedback_inbox(p_scope text default 'mine', p_actor uuid default null)
  returns table(asset_id text, concept_name text, owner_id uuid, owner_name text, pending int, latest_feedback_at timestamptz,
                processing_status text, processor uuid)
  language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := app_private.actor(p_actor);
begin
  if uid is null or app_private.role_rank(app_private.role_of(uid)) < app_private.role_rank('viewer') then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if p_scope = 'all' and app_private.role_of(uid) <> 'admin' then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    select a.id, a.concept_name, a.owner_id, m.display_name, count(c.id)::int, max(c.created_at),
           (select p.status from public.processing p where p.asset_id = a.id and p.status in ('reviewing','approved','executing') limit 1),
           (select p.processor from public.processing p where p.asset_id = a.id and p.status in ('reviewing','approved','executing') limit 1)
    from public.assets a
    join public.comments c on c.asset_id = a.id and c.status = 'open'
    left join public.members m on m.user_id = a.owner_id
    where not a.archived and (p_scope = 'all' or a.owner_id = uid)
    group by a.id, a.concept_name, a.owner_id, m.display_name
    order by max(c.created_at) desc;
end $$;

revoke all on function public.processing_start(text, text, uuid), public.processing_save_proposal(uuid, int, jsonb, uuid),
  public.processing_approve(uuid, int, jsonb, text, boolean, uuid), public.processing_complete(uuid, int, text, text, uuid),
  public.processing_set_status(uuid, int, text, text, uuid), public.revert_asset(text, text, text, uuid),
  public.feedback_inbox(text, uuid) from public, anon;
grant execute on function public.processing_start(text, text, uuid), public.processing_save_proposal(uuid, int, jsonb, uuid),
  public.processing_approve(uuid, int, jsonb, text, boolean, uuid), public.processing_complete(uuid, int, text, text, uuid),
  public.processing_set_status(uuid, int, text, text, uuid), public.revert_asset(text, text, text, uuid),
  public.feedback_inbox(text, uuid) to authenticated, service_role;
revoke all on function app_private.processing_load(uuid, int, uuid), app_private.processing_touch(public.processing, uuid, text, jsonb) from public, anon, authenticated;
