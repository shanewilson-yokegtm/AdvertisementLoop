-- One kind of feedback. The owner (or an admin) approves or rejects each item, any time. "Process" sends ALL approved,
-- still-open feedback on the ad (any version, including items that arrived after earlier decisions) into the next version.
alter table public.comments add column decision text check (decision in ('approved')),
  add column decided_by uuid references public.members(user_id), add column decided_at timestamptz;

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
    new.decision := null; new.decided_by := null; new.decided_at := null;
    return new;
  end if;
  if app_private.is_server() then return new; end if;
  if (to_jsonb(new) - 'status' - 'applied_in' - 'resolution_note' - 'resolved_by' - 'resolved_at' - 'decision' - 'decided_by' - 'decided_at')
     <> (to_jsonb(old) - 'status' - 'applied_in' - 'resolution_note' - 'resolved_by' - 'resolved_at' - 'decision' - 'decided_by' - 'decided_at') then
    raise exception 'only comment status can change' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then new.resolved_by := auth.uid(); new.resolved_at := now(); end if;
  return new;
end $$;

-- p_decision: 'approved' | 'rejected' | 'undecided' (undo)
create or replace function public.feedback_decide(p_comment uuid, p_decision text, p_reason text default null, p_actor uuid default null)
  returns public.comments language plpgsql security definer set search_path = '' as $$
declare uid uuid := app_private.actor(p_actor); c public.comments;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into c from public.comments where id = p_comment for update;
  if c.id is null or c.deleted_at is not null then raise exception 'feedback not found' using errcode = 'P0002'; end if;
  if not app_private.can_manage_as(uid, c.asset_id) then raise exception 'only the owner or an admin can approve or reject feedback' using errcode = '42501'; end if;
  if c.status = 'applied' then raise exception 'already in v% ', (select version from public.versions where id = c.applied_in) using errcode = 'P0001'; end if;
  if exists (select 1 from public.processing p where p.asset_id = c.asset_id and p.status in ('approved','executing') and c.id = any(p.comment_ids)) then
    raise exception 'this feedback is already going into the next version' using errcode = 'P0001';
  end if;
  if p_decision = 'approved' then
    update public.comments set status = 'open', decision = 'approved', decided_by = uid, decided_at = now(),
      resolution_note = null, resolved_by = null, resolved_at = null where id = c.id returning * into c;
  elsif p_decision = 'rejected' then
    update public.comments set status = 'dismissed', decision = null, decided_by = uid, decided_at = now(),
      resolution_note = left(coalesce(nullif(btrim(p_reason), ''), 'Rejected'), 1000), resolved_by = uid, resolved_at = now() where id = c.id returning * into c;
  elsif p_decision = 'undecided' then
    update public.comments set status = 'open', decision = null, decided_by = uid, decided_at = now(),
      resolution_note = null, resolved_by = null, resolved_at = null where id = c.id returning * into c;
  else raise exception 'unknown decision %', p_decision using errcode = '22023'; end if;
  return c;
end $$;

-- Process: every approved, open item on the ad goes into the next version, built on the latest version.
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
  -- Old-style drafts are replaced.
  update public.processing set status = 'cancelled', updated_at = now(), rev = rev + 1, message = 'Replaced by Process approved feedback'
    where asset_id = p_asset and status = 'reviewing';
  select coalesce(array_agg(c.id order by c.created_at), '{}') into ids from public.comments c
    where c.asset_id = p_asset and c.status = 'open' and c.decision = 'approved' and c.deleted_at is null;
  if cardinality(ids) = 0 and coalesce(btrim(p_note), '') = '' then
    raise exception 'approve at least one piece of feedback first' using errcode = '22023';
  end if;
  select a.id || '_v' || a.latest_version into latest from public.assets a where a.id = p_asset;
  insert into public.processing(asset_id, reviewed_version_id, comment_ids, processor, started_by, started_via, status, decisions, instructions, history)
  values (p_asset, latest, ids, uid, uid, 'app', 'approved',
    coalesce((select jsonb_agg(jsonb_build_object('comment_id', x, 'decision', 'apply')) from unnest(ids) x), '[]'),
    nullif(btrim(p_note), ''),
    jsonb_build_array(jsonb_build_object('at', now(), 'by', uid, 'event', 'approved', 'detail', jsonb_build_object('apply', cardinality(ids)))))
  returning * into p;
  -- Changes are coming: an approved ad goes back into review until the new version is approved.
  update public.reviews set status = 'changes', reviewer = uid, note = 'Reopened: approved feedback is going into the next version'
    where version_id = latest and status = 'approved';
  insert into public.revision_jobs(asset_id, version_id, note, requested_by, processing_id) values (p_asset, latest, p.instructions, uid, p.id);
  return p;
end $$;

revoke all on function public.feedback_decide(uuid, text, text, uuid), public.feedback_process(text, text, uuid) from public, anon;
grant execute on function public.feedback_decide(uuid, text, text, uuid), public.feedback_process(text, text, uuid) to authenticated, service_role;
