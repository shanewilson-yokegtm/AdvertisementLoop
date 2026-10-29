-- Rejecting an ad archives it (it leaves the Library) and cancels revision work that hasn't started.
alter table public.revision_jobs drop constraint revision_jobs_state_check;
alter table public.revision_jobs add constraint revision_jobs_state_check
  check (state in ('queued','working','done','needs_input','failed','cancelled'));

create or replace function app_private.assets_cancel_revisions() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.archived and not old.archived then
    update public.revision_jobs set state = 'cancelled', message = 'Ad rejected', updated_at = now()
     where asset_id = new.id and state in ('queued','needs_input','failed');
  end if;
  return new;
end $$;
revoke all on function app_private.assets_cancel_revisions() from public, anon, authenticated;
create trigger assets_cancel_revisions after update of archived on public.assets
  for each row execute function app_private.assets_cancel_revisions();
