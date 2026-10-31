-- Campaign execution ledger. Unapplied scaffold: no adapter is registered and attempt_launch stays blocked.
-- One row per launch authorization / channel / step. A step is claimed and persisted BEFORE any external call,
-- carries the intended payload hash and before-state evidence, and ends with a receipt. A claim whose worker
-- disappears, or whose outcome is not known, becomes `unknown` and must be reconciled against the platform
-- before the step can run again. Nothing here retries on its own. Status meanings:
--   succeeded  external effect confirmed (receipt or reconciled evidence)
--   failed     platform definitively rejected the call; nothing was written
--   blocked    the worker stopped under its claim before any external call (e.g. pre-activation readback drift)
--   unknown    an effect may exist or may still land; only authoritative evidence resolves it
--   absent     authoritative evidence that the attempt cannot take effect; the step may be claimed again
create table public.campaign_execution_steps (
  operation_id text primary key check (operation_id ~ '^yx_[a-f0-9]{32}$'),
  campaign_id text not null references public.campaign_records(id),
  launch_id text not null,
  channel text not null check (channel in ('meta','linkedin')),
  step text not null check (step in ('build_paused','verify_paused','activate')),
  plan_fingerprint text not null,
  payload_hash text not null,
  status text not null check (status in ('claimed','succeeded','failed','blocked','unknown','absent')),
  attempt integer not null default 1 check (attempt > 0),
  worker_id text not null,
  before_state jsonb not null,
  claimed_at timestamptz not null,
  lease_expires_at timestamptz not null,
  receipt jsonb,
  platform_ids jsonb,
  updated_at timestamptz not null default now(),
  unique (launch_id, channel, step)
);
create index campaign_execution_steps_campaign on public.campaign_execution_steps(campaign_id, launch_id);

create table public.campaign_execution_log (
  id bigint generated always as identity primary key,
  operation_id text not null references public.campaign_execution_steps(operation_id),
  campaign_id text not null references public.campaign_records(id),
  attempt integer not null, from_status text, to_status text not null,
  worker_id text not null, evidence jsonb, created_at timestamptz not null default now()
);
create index campaign_execution_log_operation on public.campaign_execution_log(operation_id, id);

do $$ declare t text;
begin
  foreach t in array array['campaign_execution_steps','campaign_execution_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy campaign_member_read on public.%I for select to authenticated using (app_private.role_at_least(''viewer''))', t);
    execute format('create policy no_oauth_connector on public.%I as restrictive for all to anon, authenticated using ((nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb ->> ''client_id'') is null) with check ((nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb ->> ''client_id'') is null)', t);
  end loop;
end $$;
create trigger campaign_history_immutable before update or delete on public.campaign_execution_log
  for each row execute function app_private.campaign_history_immutable();
-- Steps change only through the functions below; deleting one would erase evidence of a possible external effect.
create trigger campaign_history_immutable before delete on public.campaign_execution_steps
  for each row execute function app_private.campaign_history_immutable();

-- True when the campaign still holds exactly this authorization: same launch id and fingerprint, approval of the
-- same plan, status launch_authorized, and neither the authorization nor the spending window has expired.
create function app_private.campaign_launch_current(p_campaign text, p_launch text, p_fingerprint text)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select r.state->'launch'->>'id' = p_launch
      and r.state->'launch'->>'fingerprint' = p_fingerprint
      and r.state->'approval'->>'fingerprint' = p_fingerprint
      and r.state->'launch'->>'status' = 'authorized'
      and r.state->>'status' = 'launch_authorized'
      and (r.state->'launch'->>'expiresAt')::timestamptz > now()
      and (r.state->'brief'->>'spendEndsAt')::timestamptz > now()
    from public.campaign_records r where r.id = p_campaign), false)
$$;
revoke all on function app_private.campaign_launch_current(text,text,text) from public, anon, authenticated;
grant execute on function app_private.campaign_launch_current(text,text,text) to service_role;

-- Claim a step. Returns {claimed, step}. claimed=false means: already succeeded (reuse its receipt), held by a live
-- claim, or needs reconciliation/attention. An expired claim becomes `unknown` here, never re-run.
create function public.campaign_step_claim(
  p_operation text, p_campaign text, p_launch text, p_channel text, p_step text,
  p_fingerprint text, p_payload_hash text, p_before jsonb, p_worker text, p_lease_seconds integer
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.campaign_execution_steps; rec public.campaign_records;
begin
  if not app_private.is_server() then raise exception 'server only' using errcode='42501'; end if;
  if p_lease_seconds not between 5 and 900 then raise exception 'invalid lease' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation, 0));
  -- The campaign must still hold this exact authorization. Lock it so a concurrent memo edit serializes with the claim.
  select * into rec from public.campaign_records where id = p_campaign for share;
  if rec.id is null or not app_private.campaign_launch_current(p_campaign, p_launch, p_fingerprint) then
    raise exception 'stale authorization: plan, approval or launch authorization changed or expired' using errcode='40001';
  end if;
  -- Order is enforced here as well as in the worker: verify only after a recorded build, activate only after a
  -- recorded paused readback that matched the approved plan.
  if p_step = 'verify_paused' and not exists (select 1 from public.campaign_execution_steps
      where launch_id=p_launch and channel=p_channel and step='build_paused' and status='succeeded') then
    raise exception 'paused build not recorded' using errcode='40001';
  end if;
  if p_step = 'activate' and not exists (select 1 from public.campaign_execution_steps
      where launch_id=p_launch and channel=p_channel and step='verify_paused' and status='succeeded' and (receipt->>'matches')::boolean) then
    raise exception 'paused readback did not match the approved plan' using errcode='40001';
  end if;
  select * into s from public.campaign_execution_steps where operation_id = p_operation for update;
  if s.operation_id is null then
    insert into public.campaign_execution_steps(operation_id,campaign_id,launch_id,channel,step,plan_fingerprint,payload_hash,status,worker_id,before_state,claimed_at,lease_expires_at)
      values(p_operation,p_campaign,p_launch,p_channel,p_step,p_fingerprint,p_payload_hash,'claimed',p_worker,p_before,now(),now() + make_interval(secs => p_lease_seconds))
      returning * into s;
    insert into public.campaign_execution_log(operation_id,campaign_id,attempt,from_status,to_status,worker_id,evidence)
      values(s.operation_id,s.campaign_id,1,null,'claimed',p_worker,jsonb_build_object('before',p_before,'payloadHash',p_payload_hash));
    return jsonb_build_object('claimed',true,'step',to_jsonb(s));
  end if;
  if s.campaign_id <> p_campaign or s.launch_id <> p_launch or s.channel <> p_channel or s.step <> p_step
     or s.plan_fingerprint <> p_fingerprint or s.payload_hash <> p_payload_hash then
    raise exception 'conflict: operation already recorded with a different payload' using errcode='40001';
  end if;
  if s.status = 'claimed' and s.lease_expires_at <= now() then
    -- The worker may have reached the platform before it stopped. Treat as possibly applied.
    update public.campaign_execution_steps set status='unknown', updated_at=now() where operation_id=p_operation returning * into s;
    insert into public.campaign_execution_log(operation_id,campaign_id,attempt,from_status,to_status,worker_id,evidence)
      values(s.operation_id,s.campaign_id,s.attempt,'claimed','unknown',p_worker,jsonb_build_object('reason','claim lease expired without an outcome'));
  elsif s.status = 'absent' then
    -- Reconciliation proved the previous attempt had no external effect: the step may run again.
    update public.campaign_execution_steps set status='claimed', attempt=attempt+1, worker_id=p_worker, before_state=p_before,
      claimed_at=now(), lease_expires_at=now() + make_interval(secs => p_lease_seconds), receipt=null, updated_at=now()
      where operation_id=p_operation returning * into s;
    insert into public.campaign_execution_log(operation_id,campaign_id,attempt,from_status,to_status,worker_id,evidence)
      values(s.operation_id,s.campaign_id,s.attempt,'absent','claimed',p_worker,jsonb_build_object('before',p_before));
    return jsonb_build_object('claimed',true,'step',to_jsonb(s));
  end if;
  return jsonb_build_object('claimed',false,'step',to_jsonb(s));
end $$;

-- Record the outcome of a call made under a live claim. Only the claiming worker and attempt may complete it.
create function public.campaign_step_complete(
  p_operation text, p_worker text, p_attempt integer, p_outcome text, p_receipt jsonb, p_platform_ids jsonb default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.campaign_execution_steps;
begin
  if not app_private.is_server() then raise exception 'server only' using errcode='42501'; end if;
  if p_outcome not in ('succeeded','failed','blocked','unknown') then raise exception 'invalid outcome' using errcode='22023'; end if;
  if p_receipt is null then raise exception 'receipt required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation, 0));
  select * into s from public.campaign_execution_steps where operation_id = p_operation for update;
  if s.operation_id is null or s.status <> 'claimed' or s.worker_id <> p_worker or s.attempt <> p_attempt then
    raise exception 'stale claim: this worker no longer holds the step; reconcile instead' using errcode='40001';
  end if;
  update public.campaign_execution_steps set status=p_outcome, receipt=p_receipt, platform_ids=coalesce(p_platform_ids, platform_ids), updated_at=now()
    where operation_id=p_operation returning * into s;
  insert into public.campaign_execution_log(operation_id,campaign_id,attempt,from_status,to_status,worker_id,evidence)
    values(s.operation_id,s.campaign_id,s.attempt,'claimed',p_outcome,p_worker,p_receipt);
  return to_jsonb(s);
end $$;

-- Resolve an unknown step from platform evidence: applied -> succeeded, absent -> may be claimed again.
-- Still-ambiguous evidence leaves it unknown for a person to resolve.
create function public.campaign_step_reconcile(
  p_operation text, p_worker text, p_finding text, p_evidence jsonb, p_platform_ids jsonb default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.campaign_execution_steps; prior text;
begin
  if not app_private.is_server() then raise exception 'server only' using errcode='42501'; end if;
  if p_finding not in ('applied','absent','unknown') then raise exception 'invalid finding' using errcode='22023'; end if;
  if p_evidence is null then raise exception 'evidence required' using errcode='22023'; end if;
  -- A point-in-time "not found" does not prove a request still in flight cannot land later. Release a step for
  -- retry only on authoritative terminal evidence, documented provider idempotency for this operation, or a
  -- read-only step.
  if p_finding = 'absent' and coalesce(p_evidence->>'basis','') not in ('terminal_no_effect','provider_idempotency','read_only') then
    raise exception 'absent requires terminal no-effect, provider idempotency or read-only evidence' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation, 0));
  select * into s from public.campaign_execution_steps where operation_id = p_operation for update;
  if s.operation_id is null then raise exception 'unknown operation' using errcode='22023'; end if;
  if s.status = 'claimed' and s.lease_expires_at > now() then raise exception 'step is held by a live claim' using errcode='40001'; end if;
  if s.status not in ('unknown','claimed') then raise exception 'only unknown steps are reconciled' using errcode='40001'; end if;
  if p_finding = 'absent' and p_evidence->>'basis' = 'read_only' and s.step <> 'verify_paused' then
    raise exception 'read-only basis applies only to readback steps' using errcode='22023';
  end if;
  prior := s.status;
  update public.campaign_execution_steps set
    status = case p_finding when 'applied' then 'succeeded' when 'absent' then 'absent' else 'unknown' end,
    receipt = case when p_finding = 'applied' then p_evidence else receipt end,
    platform_ids = coalesce(p_platform_ids, platform_ids), updated_at = now()
    where operation_id = p_operation returning * into s;
  insert into public.campaign_execution_log(operation_id,campaign_id,attempt,from_status,to_status,worker_id,evidence)
    values(s.operation_id,s.campaign_id,s.attempt,prior,s.status,p_worker,jsonb_build_object('finding',p_finding,'evidence',p_evidence));
  return to_jsonb(s);
end $$;

-- Append evidence gathered under a live claim (e.g. the fresh pre-activation readback) before the external call.
create function public.campaign_step_evidence(p_operation text, p_worker text, p_attempt integer, p_evidence jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare s public.campaign_execution_steps;
begin
  if not app_private.is_server() then raise exception 'server only' using errcode='42501'; end if;
  if p_evidence is null then raise exception 'evidence required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation, 0));
  select * into s from public.campaign_execution_steps where operation_id = p_operation for update;
  if s.operation_id is null or s.status <> 'claimed' or s.worker_id <> p_worker or s.attempt <> p_attempt or s.lease_expires_at <= now() then
    raise exception 'stale claim: this worker no longer holds the step' using errcode='40001';
  end if;
  -- The pre-call gate also requires the authorization to still be current at this moment.
  perform 1 from public.campaign_records where id = s.campaign_id for share;
  if not app_private.campaign_launch_current(s.campaign_id, s.launch_id, s.plan_fingerprint) then
    raise exception 'stale authorization: plan, approval or launch authorization changed or expired' using errcode='40001';
  end if;
  insert into public.campaign_execution_log(operation_id,campaign_id,attempt,from_status,to_status,worker_id,evidence)
    values(s.operation_id,s.campaign_id,s.attempt,'claimed','claimed',p_worker,p_evidence);
end $$;

-- Fence: while any step is claimed or unknown, or once a channel has been activated, the memo, approval and launch
-- authorization cannot change (and an unresolved campaign cannot close). This keeps an in-flight or unknown
-- external effect from being orphaned and a renewed authorization from starting a second launch. Changing a live
-- campaign needs a separate, reviewed change workflow.
create function app_private.campaign_execution_fence() returns trigger language plpgsql set search_path = '' as $$
declare plan_change boolean; closing boolean;
begin
  closing := new.state->>'status' = 'closed' and old.state->>'status' is distinct from 'closed';
  -- The whole launch authorization object (id, status, expiry, blockers) and the campaign status are fenced,
  -- so no other command (e.g. attempt_launch) can rewrite them under an unresolved effect.
  plan_change := (old.state->'brief') is distinct from (new.state->'brief')
    or (old.state->'approval') is distinct from (new.state->'approval')
    or (old.state->'launch') is distinct from (new.state->'launch')
    or ((old.state->>'status') is distinct from (new.state->>'status') and not closing);
  if not (plan_change or closing) then return new; end if;
  if exists (select 1 from public.campaign_execution_steps where campaign_id = new.id and status in ('claimed','unknown')) then
    raise exception 'execution unresolved: a launch step is in flight or unknown; reconcile it before changing or closing the campaign' using errcode='40001';
  end if;
  if plan_change and exists (select 1 from public.campaign_execution_steps where campaign_id = new.id and step = 'activate' and status = 'succeeded') then
    raise exception 'campaign is live: plan, approval and authorization changes need a separate change workflow' using errcode='40001';
  end if;
  return new;
end $$;
create trigger campaign_execution_fence before update on public.campaign_records
  for each row execute function app_private.campaign_execution_fence();

revoke all on function public.campaign_step_claim(text,text,text,text,text,text,text,jsonb,text,integer) from public,anon,authenticated;
revoke all on function public.campaign_step_complete(text,text,integer,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.campaign_step_reconcile(text,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.campaign_step_evidence(text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.campaign_step_evidence(text,text,integer,jsonb) to service_role;
grant execute on function public.campaign_step_claim(text,text,text,text,text,text,text,jsonb,text,integer) to service_role;
grant execute on function public.campaign_step_complete(text,text,integer,text,jsonb,jsonb) to service_role;
grant execute on function public.campaign_step_reconcile(text,text,text,jsonb,jsonb) to service_role;
