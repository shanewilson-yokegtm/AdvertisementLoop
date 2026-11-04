// Registered on Ad Studio's per-person authenticated MCP server.
// Auth is supplied by that server, never inferred from tool arguments. No second shared credential.
import * as z from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Actor } from '../server/api';
import { commandSchema } from './contracts';
import { handleCampaign } from '../server/campaign-api';
import { ApiError } from '../server/api';
import { hostingBriefSchema } from './hosting-contracts';

type Registry = { registerTool: (name: string, config: any, callback: (args: any) => Promise<any>) => unknown };
export const CAMPAIGN_TOOL_NAMES = ['campaign_playbook','campaign_list','campaign_create','campaign_get','campaign_command','campaign_audit','campaign_report','campaign_closeout','campaign_due','campaign_hosting_guide','campaign_hosting_save','campaign_prepare','campaign_asset_search'] as const;
export function registerCampaignTools(server: Registry, db: SupabaseClient, actor: Actor) {
  const id = z.string().regex(/^yc_[a-f0-9]{24}$/);
  const reg = (name: string, description: string, schema: z.ZodRawShape, write: boolean, route: (a: any) => { method: string; path: string[]; body?: unknown; query?: Record<string,string> }) => {
    const title = name.replaceAll('_',' ').replace(/^c/,'C');
    server.registerTool(name, { title, description, inputSchema: schema,
      annotations: { title, readOnlyHint: !write, destructiveHint: false, openWorldHint: false } }, async args => {
      try {
        const r = route(args); const data = await handleCampaign(db, actor, r.method, r.path, r.body || null, new URLSearchParams(r.query));
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: JSON.stringify(e instanceof ApiError ? { error: e.code, message: e.message } : { error: 'unavailable' }) }] }; }
    });
  };
  reg('campaign_playbook','Read campaign defaults, required evidence and actual connection status.',{},false,()=>({method:'GET',path:['playbook']}));
  reg('campaign_hosting_guide','Hosting skill v1: naming conventions, preparation template and actual hosting capabilities. No platform execution.',{},false,()=>({method:'GET',path:['hosting-guide']}));
  reg('campaign_asset_search','Find Library assets by concept name, format and approval. Returns exact latest version IDs and readiness, with truncation explicit. Use get_ad for older versions.',
    {query:z.string().max(100).optional(),format:z.enum(['square','feed45','vertical','landscape']).optional(),approvedOnly:z.boolean().optional()},false,
    a=>({method:'GET',path:['hosting-assets'],query:{q:a.query||'',...(a.format?{format:a.format}:{}),approvedOnly:String(a.approvedOnly ?? true)}}));
  reg('campaign_hosting_save','Save a hosting-only preparation brief in a draft campaign. Missing decisions are null. Preserves stable identities, revision checks and retries. Does not approve, launch or reject assets.',
    {campaignId:id,expectedRevision:z.number().int().nonnegative(),requestKey:z.string().min(8).max(120),preparation:hostingBriefSchema},true,
    a=>({method:'POST',path:[a.campaignId,'commands'],body:{expectedRevision:a.expectedRevision,requestKey:a.requestKey,command:{type:'save_preparation',preparation:a.preparation}}}));
  reg('campaign_prepare','GET the current hosting review packet: manifest, questions, tracking, CSV and Markdown. Read-only even when called compile/prepare: computed on demand, never writes or persists a campaign. Use for read-only review requests. An empty legacy deploymentPlan is unrelated. No platform work or spend. libraryCheckedAt is outside the stable manifest hash.',
    {campaignId:id},false,a=>({method:'GET',path:[a.campaignId,'preparation']}));
  reg('campaign_list','List shared campaigns. A creator can resume another teammate’s campaign; revisions prevent overwrite.',{},false,()=>({method:'GET',path:[]}));
  reg('campaign_create','Create a shared campaign. Reuse the request key when recovering a lost response.',{title:z.string().min(1).max(150),requestKey:z.string().min(8).max(120)},true,a=>({method:'POST',path:[],body:a}));
  reg('campaign_get','Get saved campaign state, revision and hostingPreparation review-packet capability. When preparation exists, call read-only campaign_prepare for the current packet; legacy memo/deploymentPlan may be empty.',{campaignId:id},false,a=>({method:'GET',path:[a.campaignId]}));
  reg('campaign_command','Save a complete memo, approve it, authorize launch only after the person says go, attempt launch, import evidence or close. Include the last observed revision. Adapters are not connected; an attempt records a blocker and never launches.',
    {campaignId:id,expectedRevision:z.number().int().nonnegative(),requestKey:z.string().min(8).max(120),command:commandSchema},true,a=>({method:'POST',path:[a.campaignId,'commands'],body:{expectedRevision:a.expectedRevision,requestKey:a.requestKey,command:a.command}}));
  reg('campaign_audit','Get imported settings, captured plan and differences. Manual evidence is explicitly labelled.',{campaignId:id},false,a=>({method:'GET',path:[a.campaignId,'observations']}));
  reg('campaign_report','Performance by concept, channel, audience or version. Unavailable and conflicting sources never become zero.',{campaignId:id,groupBy:z.enum(['concept','channel','audience','version']).optional()},false,a=>({method:'GET',path:[a.campaignId,'report'],query:{groupBy:a.groupBy||'concept'}}));
  reg('campaign_closeout','Generate an evidence packet against the declared hypothesis and dates; human judgment completes the learning memo.',{campaignId:id},false,a=>({method:'GET',path:[a.campaignId,'closeout']}));
  reg('campaign_due','List campaigns past their analysis date. No scheduled worker is enabled.',{},false,()=>({method:'GET',path:['due']}));
}
