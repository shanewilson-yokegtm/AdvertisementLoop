-- Voice notes on ad feedback: a comment can carry a recorded audio clip.
-- The audio lives in the private ad-assets bucket under comments/<asset_id>/.
alter table public.comments
  add column audio_path text,
  add column audio_sec numeric check (audio_sec is null or (audio_sec > 0 and audio_sec <= 300)),
  add constraint comments_audio_path_scope check (audio_path is null or audio_path like 'comments/' || asset_id || '/%');
