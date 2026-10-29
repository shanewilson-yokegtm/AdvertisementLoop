-- Accepting feedback reopens an approved ad: when the owner (or an admin) commits accepted comments for the next
-- version, the approval on the reviewed version is withdrawn ("changes"), so the ad leaves Approved until the new
-- version is approved. The earlier approval stays in review_history.
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
    -- Only ignored comments: close them (reasons kept), no new version, approval untouched.
    if exists (select 1 from jsonb_array_elements(p_decisions) x where x->>'decision' = 'dismiss') then
      for d in select * from jsonb_array_elements(p_decisions) loop
        if d->>'decision' = 'dismiss' then
          update public.comments set status = 'dismissed', resolved_by = uid, resolved_at = now(),
            resolution_note = left(coalesce(d->>'note', 'Ignored'), 1000) where id = (d->>'comment_id')::uuid and status = 'open';
        end if;
      end loop;
      update public.processing set decisions = p_decisions, status = 'done', processor = uid, rev = rev + 1, updated_at = now(),
        message = 'Ignored feedback closed; no new version',
        history = app_private.processing_touch(p, uid, 'closed_ignored', '{}') where id = p_id returning * into p;
      return p;
    end if;
    raise exception 'select at least one change to execute' using errcode = '22023';
  end if;
  update public.processing set decisions = p_decisions, instructions = nullif(btrim(p_instructions), ''), status = 'approved',
    processor = uid, rev = rev + 1, updated_at = now(),
    history = app_private.processing_touch(p, uid, 'approved', jsonb_build_object('apply', n_apply)) where id = p_id returning * into p;
  -- Changes are coming: an approved ad goes back into the workflow until the new version is approved.
  update public.reviews set status = 'changes', reviewer = uid,
    note = 'Reopened: accepted feedback is going into the next version'
  where version_id = p.reviewed_version_id and status = 'approved';
  if p_queue_worker then
    insert into public.revision_jobs(asset_id, version_id, note, requested_by, processing_id)
    values (p.asset_id, p.reviewed_version_id, p.instructions, uid, p.id);
  end if;
  return p;
end $$;
