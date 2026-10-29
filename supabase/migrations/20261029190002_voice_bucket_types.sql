-- Supabase-only: let the media bucket accept recorded audio (Chrome/Firefox record webm/ogg, Safari mp4).
update storage.buckets
   set allowed_mime_types = array['image/png','image/jpeg','image/webp','video/mp4','video/quicktime','video/webm',
                                  'audio/webm','audio/mp4','audio/ogg','audio/mpeg']
 where id = 'ad-assets';
