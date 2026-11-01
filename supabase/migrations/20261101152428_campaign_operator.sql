-- Campaign operator scaffold. No credentials, firm accounts, live mutations or schedules are configured here.
create table public.campaign_records (
  id text primary key check (id ~ '^yc_[a-f0-9]{24}$'),
  owner_id uuid not null references public.members(user_id),
  revision integer not null check (revision > 0),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (state->>'id' = id and (state->>'revision')::integer = revision and (state->>'ownerId')::uuid = owner_id)
);
create index campaign_records_updated on public.campaign_records(updated_at desc, id);
create table public.campaign_events (
  id uuid primary key default gen_random_uuid(), campaign_id text not null references public.campaign_records(id),
  revision integer not null, actor_id uuid not null references public.members(user_id),
  kind text not null, request_key text not null, request_hash text not null, result jsonb not null,
  note text, created_at timestamptz not null default now(),
  unique(campaign_id, revision), unique(campaign_id, request_key)
);
create table public.campaign_observations (
  id uuid primary key default gen_random_uuid(), campaign_id text not null references public.campaign_records(id),
  event_id uuid not null unique references public.campaign_events(id), actor_id uuid not null references public.members(user_id),
  provenance text not null default 'manual_import' check (provenance = 'manual_import'),
  data jsonb not null, plan_snapshot jsonb not null, audit jsonb not null, created_at timestamptz not null default now()
);
create index campaign_observations_recent on public.campaign_observations(campaign_id, created_at desc);
create table public.campaign_metric_batches (
  id uuid primary key default gen_random_uuid(), campaign_id text not null references public.campaign_records(id),
  event_id uuid not null unique references public.campaign_events(id), actor_id uuid not null references public.members(user_id),
  provenance text not null default 'manual_import' check (provenance = 'manual_import'),
  data jsonb not null, created_at timestamptz not null default now()
);
create index campaign_metric_batches_recent on public.campaign_metric_batches(campaign_id, created_at desc);

-- Browser members can read shared records. All writes go through the authenticated application and one atomic RPC.
-- Explicit grants override installations with permissive default grants. Connector OAuth tokens cannot read tables.
do $$ declare t text;
begin
  foreach t in array array['campaign_records','campaign_events','campaign_observations','campaign_metric_batches'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy campaign_member_read on public.%I for select to authenticated using (app_private.role_at_least(''viewer''))', t);
    execute format('create policy no_oauth_connector on public.%I as restrictive for all to anon, authenticated using ((nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb ->> ''client_id'') is null) with check ((nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb ->> ''client_id'') is null)', t);
  end loop;
end $$;

create function public.campaign_commit(
  p_campaign text, p_expected integer, p_actor uuid, p_kind text, p_key text, p_hash text,
  p_state jsonb, p_note text default null, p_observation jsonb default null, p_audit jsonb default null, p_metrics jsonb default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare existing public.campaign_records; prior public.campaign_events; ev uuid; role_name text; result jsonb;
begin
  if not app_private.is_server() then raise exception 'server only' using errcode='42501'; end if;
  role_name := app_private.role_of(p_actor);
  if app_private.role_rank(role_name) < app_private.role_rank('creator') then raise exception 'creator permission required' using errcode='42501'; end if;
  if p_kind in ('approve','authorize_launch') and role_name not in ('approver','admin') then raise exception 'approver permission required' using errcode='42501'; end if;
  -- Serializes create/update/replay for one campaign, including when no row exists yet.
  perform pg_advisory_xact_lock(hashtextextended(p_campaign, 0));
  select * into prior from public.campaign_events where campaign_id=p_campaign and request_key=p_key;
  if found then
    if prior.request_hash <> p_hash or prior.actor_id <> p_actor then raise exception 'conflict: request key already used for a different command or actor' using errcode='40001'; end if;
    return jsonb_build_object('state',prior.result,'repeated',true);
  end if;
  select * into existing from public.campaign_records where id=p_campaign for update;
  if coalesce(existing.revision,0) <> p_expected then raise exception 'conflict: campaign changed; reload before saving' using errcode='40001'; end if;
  if (p_state->>'revision')::integer <> p_expected+1 or p_state->>'id' <> p_campaign then raise exception 'invalid revision or campaign' using errcode='22023'; end if;
  if existing.id is null then
    if p_kind <> 'create' or (p_state->>'ownerId')::uuid <> p_actor then raise exception 'invalid creation' using errcode='22023'; end if;
    insert into public.campaign_records(id,owner_id,revision,state) values(p_campaign,p_actor,1,p_state);
  else
    if (p_state->>'ownerId')::uuid <> existing.owner_id then raise exception 'owner is immutable' using errcode='22023'; end if;
    update public.campaign_records set revision=p_expected+1,state=p_state,updated_at=now() where id=p_campaign;
  end if;
  insert into public.campaign_events(campaign_id,revision,actor_id,kind,request_key,request_hash,result,note)
    values(p_campaign,p_expected+1,p_actor,p_kind,p_key,p_hash,p_state,p_note) returning id into ev;
  if p_observation is not null then
    insert into public.campaign_observations(campaign_id,event_id,actor_id,data,plan_snapshot,audit)
      values(p_campaign,ev,p_actor,p_observation,coalesce(existing.state,p_state),p_audit);
  end if;
  if p_metrics is not null then
    insert into public.campaign_metric_batches(campaign_id,event_id,actor_id,data) values(p_campaign,ev,p_actor,p_metrics);
  end if;
  return jsonb_build_object('state',p_state,'repeated',false);
end $$;
revoke all on function public.campaign_commit(text,integer,uuid,text,text,text,jsonb,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.campaign_commit(text,integer,uuid,text,text,text,jsonb,text,jsonb,jsonb,jsonb) to service_role;

-- History is append-only, including for application service calls. Direct database owners remain administrators.
create function app_private.campaign_history_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'campaign history is append-only' using errcode='42501'; end $$;
do $$ declare t text;
begin
  foreach t in array array['campaign_events','campaign_observations','campaign_metric_batches'] loop
    execute format('create trigger campaign_history_immutable before update or delete on public.%I for each row execute function app_private.campaign_history_immutable()', t);
  end loop;
end $$;
