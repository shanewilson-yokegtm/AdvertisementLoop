-- @supabase-only (storage/realtime; skipped by the PGlite tests)
-- Supabase-only: uploads go into an ad's folder only for its owner or an admin.
-- Voice notes (comments/<asset_id>/...) can be added by any member who can comment, on an existing ad.
drop policy "ad-assets upload" on storage.objects;
create policy "ad-assets upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ad-assets' and app_private.role_at_least('creator') and (
      ((storage.foldername(name))[1] = 'comments'
        and exists (select 1 from public.assets a where a.id = (storage.foldername(name))[2]))
      or app_private.can_manage((storage.foldername(name))[1])
    )
  );
