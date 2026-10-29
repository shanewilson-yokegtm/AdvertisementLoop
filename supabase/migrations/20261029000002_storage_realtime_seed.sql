-- Supabase-only pieces: private media bucket, its access rules, realtime, first admin.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ad-assets', 'ad-assets', false, 524288000,
        array['image/png','image/jpeg','image/webp','video/mp4','video/quicktime','video/webm'])
on conflict (id) do nothing;

-- Members read every file in the bucket (via short-lived signed URLs); creators upload.
-- Nobody overwrites or deletes through the API: a change is a new file + new version.
create policy "ad-assets read" on storage.objects for select to authenticated
  using (bucket_id = 'ad-assets' and app_private.role_at_least('viewer'));
create policy "ad-assets upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'ad-assets' and app_private.role_at_least('creator'));

-- Live updates for the Library, comments and conversations.
alter publication supabase_realtime add table public.assets, public.versions, public.comments,
  public.reviews, public.chat_messages, public.chats;

-- First admin. Everyone else at @yokegtm.com joins as creator on first sign-in.
insert into public.role_grants (email, role) values ('shane.wilson@yokegtm.com', 'admin')
on conflict (email) do nothing;
