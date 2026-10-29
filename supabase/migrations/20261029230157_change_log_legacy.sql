-- Change log: include versions made before review records existed (from comments marked applied in them).
-- Versions made before review records existed: rebuild the round from comments marked as used in that version.
create or replace function app_private.legacy_round_json(p_version text) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select case when count(*) = 0 then null else jsonb_build_object('reviewed_version', null, 'decided_by', null, 'note', null,
    'accepted', jsonb_agg(jsonb_build_object('author', coalesce(m.display_name, c.legacy_author, 'Teammate'), 'body', c.body, 'at_sec', c.at_sec,
      'source', c.source, 'source_link', c.source_link) order by c.created_at),
    'ignored', '[]'::jsonb) end
  from public.comments c left join public.members m on m.user_id = c.author
  where c.applied_in = p_version and c.status = 'applied'
$$;
revoke all on function app_private.legacy_round_json(text) from public, anon, authenticated;
create or replace function public.change_log(p_asset text, p_actor uuid default null)
  returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := app_private.actor(p_actor);
begin
  if uid is null or app_private.role_rank(app_private.role_of(uid)) < app_private.role_rank('viewer') then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(entry order by (entry->>'at')::timestamptz desc) from (
      -- versions, each with the round that produced it (if any)
      select jsonb_build_object(
        'kind', 'version', 'version_id', v.id, 'version', v.version, 'at', v.created_at,
        'from_version', (select pv.version from public.versions pv where pv.id = v.parent_version_id),
        'made_by', coalesce((select m.display_name from public.members m where m.user_id = v.created_by), v.legacy_creator, 'Claude'),
        'what_changed', v.revision_note,
        'reverted_from', (select rv.version from public.versions rv where rv.id = v.source->>'reverted_from'),
        'round', coalesce(
          (select app_private.round_json(p.id) from public.processing p where p.result_version_id = v.id and p.status = 'done' limit 1),
          app_private.legacy_round_json(v.id))
      ) as entry
      from public.versions v where v.asset_id = p_asset
      union all
      -- rounds that closed feedback without a new version (all ignored)
      select jsonb_build_object('kind', 'closed', 'at', p.updated_at, 'round', app_private.round_json(p.id))
      from public.processing p where p.asset_id = p_asset and p.status = 'done' and p.result_version_id is null
    ) t), '[]'::jsonb);
end $$;

