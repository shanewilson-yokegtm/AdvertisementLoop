// Higgsfield SDK example: one Seedance 2.5 text-to-video generation (billable).
// Run: node --env-file=.env.local --experimental-strip-types index.ts
// HF_CREDENTIALS ("key-id:key-secret") is read from the environment at runtime and never printed.
import { config, higgsfield } from '@higgsfield/client/v2';

const MODEL = 'bytedance/seedance-2.5/text-to-video';

async function main(): Promise<number> {
  if (!process.env.HF_CREDENTIALS) {
    console.error('HF_CREDENTIALS is not set. Add it to .env.local (key-id:key-secret).');
    return 2;
  }
  config({ credentials: process.env.HF_CREDENTIALS });

  console.log(`Submitting ${MODEL} and waiting for the result...`);
  let result;
  try {
    result = await higgsfield.subscribe(MODEL, {
      input: { prompt: 'A cinematic scene at sunset', duration: 5, resolution: '720p', aspect_ratio: '16:9' },
      withPolling: true,
    });
  } catch (err: any) {
    // SDK errors: AuthenticationError, NotEnoughCreditsError, ValidationError, BadInputError, TimeoutError, APIError.
    console.error(`Request failed: ${err?.name || 'Error'}${err?.message ? ' - ' + err.message : ''}`);
    return 1;
  }

  const status = String(result.status);
  if (status === 'completed' && result.video?.url) {
    console.log(`Completed. Request ${result.request_id}`);
    console.log(`Video URL: ${result.video.url}`);
    return 0;
  }
  if (status === 'completed') { console.error(`Completed without a video URL (request ${result.request_id}).`); return 1; }
  if (status === 'nsfw') { console.error(`Moderated: the request was blocked by content moderation (request ${result.request_id}).`); return 1; }
  if (status === 'failed') { console.error(`Generation failed (request ${result.request_id}).`); return 1; }
  if (status === 'canceled' || status === 'cancelled') { console.error(`Generation was canceled (request ${result.request_id}).`); return 1; }
  console.error(`Not finished: status "${status}" (request ${result.request_id}).`);
  return 1;
}

main().then(code => process.exit(code));
