-- Supabase-only: editable sources can be stored next to the media; processing/Slack rows stream live to the app.
update storage.buckets
   set allowed_mime_types = array['image/png','image/jpeg','image/webp','video/mp4','video/quicktime','video/webm',
                                  'audio/webm','audio/mp4','audio/ogg','audio/mpeg',
                                  'application/json','application/zip','image/svg+xml','text/html','text/plain']
 where id = 'ad-assets';
alter publication supabase_realtime add table public.processing, public.slack_posts, public.slack_reactions;
