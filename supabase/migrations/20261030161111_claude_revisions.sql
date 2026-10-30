-- Finish an approved-feedback revision in your own Claude (connector), for ads the scheduled worker can't rebuild.
-- One run has exactly one maker: the scheduled worker, Higgsfield, or one person's Claude. Claiming is atomic against
-- the worker (its queued job is cancelled in the same transaction; a job it already took blocks the claim) and against
-- other people (an active claim can't be taken silently; only a stale one, explicitly, and that is recorded).
-- Only the approved items, frozen at claim time, go into the run. Feedback is marked applied by processing_complete,
-- which still requires the new version to name this run and the exact reviewed parent.

alter table public.processing drop constraint processing_engine_check;
alter table public.processing add constraint processing_engine_check check (engine in ('worker', 'higgsfield', 'claude'));
alter table public.processing add column claimed_by uuid references public.members(user_id);
alter table public.processing add column claimed_at timestamptz;

-- Only the person whose Claude claimed a run may change it (save proposal, complete, fail, cancel). Everyone else,
-- including admins, must take over explicitly through revision_claim.
create or replace function app_private.processing_load(p_id uuid, p_rev int, p_uid uuid) returns public.processing
  language plpgsql security definer set search_path = '' as $$
declare p public.processing;
begin
  if p_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into p from public.processing where id = p_id for update;
  if p.id is null then raise exception 'processing % not found', p_id using errcode = 'P0002'; end if;
  if not app_private.can_manage_as(p_uid, p.asset_id) then raise exception 'only the owner or an admin can process this feedback' using errcode = '42501'; end if;
  if p.engine = 'claude' and p.claimed_by is distinct from p_uid and p.status in ('approved', 'executing') then
    raise exception 'conflict: % is making this version in their Claude', coalesce((select display_name from public.members where user_id = p.claimed_by), 'someone')
      using errcode = '40001';
  end if;
  if p_rev is not null and p.rev <> p_rev then
    raise exception 'conflict: this review changed (rev % now, you had %); reload it', p.rev, p_rev using errcode = '40001';
  end if;
  return p;
end $$;
revoke all on function app_private.processing_load(uuid, int, uuid) from public, anon, authenticated;

create or replace function public.revision_claim(p_asset text, p_note text default null, p_take_over boolean default false, p_actor uuid default null)
  returns public.processing language plpgsql security definer set search_path = '' as $$
declare uid uuid := app_private.actor(p_actor); p public.processing; parent public.versions; ids uuid[]; n int; who text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not app_private.can_manage_as(uid, p_asset) then raise exception 'only the owner or an admin can revise this ad' using errcode = '42501'; end if;
  if app_private.role_rank(app_private.role_of(uid)) < app_private.role_rank('creator') then raise exception 'creators only' using errcode = '42501'; end if;
  perform 1 from public.assets where id = p_asset and not archived for update;
  if not found then raise exception 'ad not found or archived' using errcode = 'P0002'; end if;

  select * into p from public.processing where asset_id = p_asset and status in ('approved', 'executing') order by created_at desc limit 1 for update;
  if p.id is not null then
    if p.engine = 'higgsfield' then raise exception 'conflict: this version is rendering in Higgsfield' using errcode = '40001'; end if;
    if p.engine = 'claude' then
      if p.claimed_by = uid then
        update public.processing set claimed_at = now(), updated_at = now() where id = p.id returning * into p;
        return p;                                               -- resume your own run
      end if;
      who := coalesce((select display_name from public.members where user_id = p.claimed_by), 'someone');
      if p.claimed_at > now() - interval '2 hours' then
        raise exception 'conflict: % is making this version in their Claude (since %)', who, to_char(p.claimed_at, 'HH24:MI "UTC"') using errcode = '40001';
      end if;
      if not coalesce(p_take_over, false) then
        raise exception 'conflict: %''s Claude claimed this run at % and went quiet; take it over explicitly to continue', who, to_char(p.claimed_at, 'Mon DD HH24:MI "UTC"') using errcode = '40001';
      end if;
      update public.processing set claimed_by = uid, claimed_at = now(), processor = uid, rev = rev + 1, updated_at = now(),
        history = app_private.processing_touch(p, uid, 'takeover', jsonb_build_object('from', p.claimed_by, 'via', 'claude'))
        where id = p.id returning * into p;
      return p;
    end if;
    -- engine = 'worker': take it only while the worker hasn't started. Atomic with the worker's own claim.
    update public.revision_jobs set state = 'cancelled', message = 'Taken by ' || coalesce((select display_name from public.members where user_id = uid), 'the owner') || '''s Claude', updated_at = now()
      where processing_id = p.id and state = 'queued';
    get diagnostics n = row_count;
    if n = 0 and exists (select 1 from public.revision_jobs where processing_id = p.id and state = 'working') then
      raise exception 'conflict: the scheduled worker is already making this version' using errcode = '40001';
    end if;
    update public.processing set engine = 'claude', status = 'executing', claimed_by = uid, claimed_at = now(), processor = uid, rev = rev + 1, updated_at = now(),
      history = app_private.processing_touch(p, uid, 'claimed', jsonb_build_object('via', 'claude', 'from', 'worker'))
      where id = p.id returning * into p;
    return p;
  end if;

  -- New run on the newest real version (failed render placeholders are skipped; an unfinished render blocks it).
  if exists (select 1 from public.versions v where v.asset_id = p_asset and v.file_path is null and v.render->>'state' in ('pending','rendering')
             and v.version > coalesce((select max(x.version) from public.versions x where x.asset_id = p_asset and x.file_path is not null), 0)) then
    raise exception 'a render is still in progress for this ad' using errcode = 'P0001';
  end if;
  select v.* into parent from public.versions v where v.asset_id = p_asset and v.file_path is not null order by v.version desc limit 1;
  if parent.id is null then raise exception 'this ad has no finished version to revise yet' using errcode = '22023'; end if;
  update public.processing set status = 'cancelled', updated_at = now(), rev = rev + 1, message = 'Replaced by a revision in Claude'
    where asset_id = p_asset and status = 'reviewing';
  select coalesce(array_agg(c.id order by c.created_at), '{}') into ids from public.comments c
    where c.asset_id = p_asset and c.status = 'open' and c.decision = 'approved' and c.deleted_at is null;
  if cardinality(ids) = 0 and coalesce(btrim(p_note), '') = '' then
    raise exception 'approve at least one piece of feedback first' using errcode = '22023';
  end if;
  insert into public.processing(asset_id, reviewed_version_id, comment_ids, processor, started_by, started_via, status, engine, claimed_by, claimed_at,
                                decisions, instructions, history, feedback_snapshot)
  values (p_asset, parent.id, ids, uid, uid, 'claude', 'executing', 'claude', uid, now(),
    coalesce((select jsonb_agg(jsonb_build_object('comment_id', x, 'decision', 'apply')) from unnest(ids) x), '[]'),
    nullif(left(btrim(p_note), 2000), ''),
    jsonb_build_array(jsonb_build_object('at', now(), 'by', uid, 'event', 'claimed', 'detail', jsonb_build_object('apply', cardinality(ids), 'via', 'claude'))),
    app_private.feedback_snapshot(ids))
  returning * into p;
  update public.reviews set status = 'changes', reviewer = uid, note = 'Reopened: approved feedback is going into the next version'
    where version_id = parent.id and status = 'approved';
  return p;
end $$;
revoke all on function public.revision_claim(text, text, boolean, uuid) from public, anon;
grant execute on function public.revision_claim(text, text, boolean, uuid) to authenticated, service_role;
