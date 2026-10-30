// Register this on Ad Studio's per-person authenticated MCP server after its OAuth branch is merged.
// Auth is supplied by that server, never inferred from tool arguments. No second shared credential.
import * as z from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Actor } from '../server/api';
import { commandSchema } from './contracts';
import { handleCampaign } from '../server/campaign-api';
import { ApiError } from '../server/api';

type Registry = { registerTool: (name: string, config: any, callback: (args: any) => Promise<any>) => unknown };
export function registerCampaignTools(server: Registry, db: SupabaseClient, actor: Actor) {
  const id = z.string().regex(/^yc_[a-f0-9]{24}$/);
  const reg = (name: string, description: string, schema: z.ZodRawShape, write: boolean, route: (a: any) => { method: string; path: string[]; body?: unknown; query?: Record<string,string> }) => {
    server.registerTool(name, { description, inputSchema: schema,
      annotations: { readOnlyHint: !write, destructiveHint: false, openWorldHint: false } }, async args => {
      try {
        const r = route(args); const data = await handleCampaign(db, actor, r.method, r.path, r.body || null, new URLSearchParams(r.query));
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: JSON.stringify(e instanceof ApiError ? { error: e.code, message: e.message } : { error: 'unavailable' }) }] }; }
    });
  };
  reg('campaign_playbook','Read campaign defaults, required evidence and actual connection status.',{},false,()=>({method:'GET',path:['playbook']}));
  reg('campaign_list','List shared campaigns. A creator can resume another teammate’s campaign; revisions prevent overwrite.',{},false,()=>({method:'GET',path:[]}));
  reg('campaign_create','Create a shared campaign. Reuse the request key when recovering a lost response.',{title:z.string().min(1).max(150),requestKey:z.string().min(8).max(120)},true,a=>({method:'POST',path:[],body:a}));
  reg('campaign_get','Get current memo, revision, fingerprint and exact channel deployment plans.',{campaignId:id},false,a=>({method:'GET',path:[a.campaignId]}));
  reg('campaign_command','Save a complete memo, approve it, authorize launch only after the person says go, attempt launch, import evidence or close. Include the last observed revision. Adapters are not connected; an attempt records a blocker and never launches.',
    {campaignId:id,expectedRevision:z.number().int().nonnegative(),requestKey:z.string().min(8).max(120),command:commandSchema},true,a=>({method:'POST',path:[a.campaignId,'commands'],body:{expectedRevision:a.expectedRevision,requestKey:a.requestKey,command:a.command}}));
  reg('campaign_audit','Get imported settings, captured plan and differences. Manual evidence is explicitly labelled.',{campaignId:id},false,a=>({method:'GET',path:[a.campaignId,'observations']}));
  reg('campaign_report','Performance by concept, channel, audience or version. Unavailable and conflicting sources never become zero.',{campaignId:id,groupBy:z.enum(['concept','channel','audience','version']).optional()},false,a=>({method:'GET',path:[a.campaignId,'report'],query:{groupBy:a.groupBy||'concept'}}));
  reg('campaign_closeout','Generate an evidence packet against the declared hypothesis and dates; human judgment completes the learning memo.',{campaignId:id},false,a=>({method:'GET',path:[a.campaignId,'closeout']}));
  reg('campaign_due','List campaigns past their analysis date. No scheduled worker is enabled.',{},false,()=>({method:'GET',path:['due']}));
}
