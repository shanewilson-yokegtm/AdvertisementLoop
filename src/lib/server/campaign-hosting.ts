import type { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignState } from '../campaigns/contracts';
import { compileHosting, type LibraryFact } from '../campaigns/hosting';
import { ApiError, dbError } from './api';

/** Search latest versions without making the member enumerate Library IDs. Results disclose truncation. */
export async function hostingAssetSearch(db: SupabaseClient, query: string, format: string | null, approvedOnly: boolean) {
  let q = db.from('assets').select('id,concept_name,kind,format,latest_version').eq('archived',false).order('updated_at',{ascending:false}).limit(101);
  if (query) q=q.ilike('concept_name','%'+query.replace(/[\\%_]/g,c=>'\\'+c)+'%');
  if (format) q=q.eq('format',format);
  const assets=await q; if (assets.error) throw dbError(assets.error);
  const rows=(assets.data || []).slice(0,100);
  const ids=rows.filter(a=>a.latest_version>0).map(a=>`${a.id}_v${a.latest_version}`);
  if (!ids.length) return {items:[],hasMore:(assets.data?.length || 0)>100,scope:'latest_versions'};
  const [versions,reviews]=await Promise.all([
    db.from('versions').select('id,asset_id,version,width,height,render,qa,file_path').in('id',ids),
    db.from('reviews').select('version_id,status').in('version_id',ids),
  ]);
  for(const r of [versions,reviews])if(r.error)throw dbError(r.error);
  const items=rows.flatMap(a=>{
    const v=versions.data?.find(v=>v.asset_id === a.id && v.version === a.latest_version);
    const approved=v && reviews.data?.some(r=>r.version_id === v.id && r.status === 'approved');
    if(!v || approvedOnly && !approved)return [];
    return [{assetId:a.id,versionId:v.id,conceptName:a.concept_name,kind:a.kind,format:a.format,width:v.width,height:v.height,
      approved:!!approved,ready:!!v.file_path&&v.render?.state === 'ready'&&!v.qa?.some((q:any)=>q.status === 'fail'),libraryPath:`/a/${a.id}?v=${v.id}`}];
  });
  return {items,hasMore:(assets.data?.length || 0)>100,scope:'latest_versions',note:'Older approved versions can be inspected with get_ad. If hasMore is true, narrow the name search.'};
}

/** One bounded batch per table, rather than two requests per rendition. Never returns storage paths or credentials. */
export async function hostingPacket(db: SupabaseClient, state: CampaignState) {
  if (!state.preparation) throw new ApiError(409,'preparation_missing','Save a hosting preparation brief first. Missing decisions can be null.');
  const refs = state.preparation.ads.filter(a=>a.disposition === 'included').flatMap(a=>a.renditions);
  const ids = [...new Set(refs.map(r=>r.versionId))];
  let facts: LibraryFact[] = [];
  if (ids.length) {
    const [assets,versions,reviews] = await Promise.all([
      db.from('assets').select('id,kind,archived').in('id',[...new Set(refs.map(r=>r.assetId))]),
      db.from('versions').select('id,asset_id,file_path,width,height,render,qa,content_type').in('id',ids),
      db.from('reviews').select('version_id,status').in('version_id',ids),
    ]);
    for (const r of [assets,versions,reviews]) if (r.error) throw dbError(r.error);
    facts = (versions.data || []).flatMap((v:any) => {
      const a = assets.data?.find((a:any)=>a.id === v.asset_id);
      if (!a) return [];
      return [{assetId:a.id,versionId:v.id,archived:!!a.archived,kind:a.kind,fileReady:!!v.file_path && v.render?.state === 'ready',
        width:v.width,height:v.height,approved:reviews.data?.some((r:any)=>r.version_id === v.id && r.status === 'approved') ?? false,
        qaFailed:!!v.qa?.some((q:any)=>q.status === 'fail'),contentType:v.content_type ?? null}];
    });
  }
  return {...compileHosting(state,state.preparation,facts),libraryCheckedAt:new Date().toISOString()};
}
