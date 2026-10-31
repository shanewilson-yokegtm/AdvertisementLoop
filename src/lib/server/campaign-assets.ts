import type { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignState } from '../campaigns/contracts';
import { ApiError, dbError } from './api';

const unwrap = <T>(r: { data: T; error: any }): T => { if (r.error) throw dbError(r.error); return r.data; };

/** Every creative in the plan must be the exact approved, ready Ad Studio version with the declared dimensions.
 * Checked at approval, launch authorization, and again by the executor before any external step. */
export async function assertAssetsReady(db: SupabaseClient, state: CampaignState, channel?: string) {
  for (const p of state.brief?.channels || []) {
    if (channel && p.channel !== channel) continue;
    for (const c of p.creatives) {
      const version: any = unwrap(await db.from('versions').select('id,asset_id,file_path,render,qa,width,height').eq('id', c.versionId).maybeSingle());
      const review: any = unwrap(await db.from('reviews').select('status').eq('version_id', c.versionId).maybeSingle());
      if (!version || version.asset_id !== c.assetId || !version.file_path || version.render?.state !== 'ready' || review?.status !== 'approved'
        || version.qa?.some((q: any) => q.status === 'fail') || version.width !== c.width || version.height !== c.height)
        throw new ApiError(409, 'asset_not_ready', `Creative ${c.versionId} must be an approved, ready Ad Studio version with the declared dimensions`);
    }
  }
}
