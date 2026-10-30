// Ad Studio tools for the Claude connector. Every tool calls the same router as the personal-token API (`handle`),
// acting as the signed-in member, so ownership, roles and validation are identical. Nothing here widens access.
import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, handle, type Actor } from './api';

type Call = (method: 'GET' | 'POST', parts: string[], body?: any, query?: Record<string, string>) => Promise<any>;

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => {
  const err = e instanceof ApiError ? { error: e.code, message: e.message } : { error: 'error', message: 'Unexpected error' };
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(err) }] };
};
const run = (fn: () => Promise<unknown>) => fn().then(text, fail);

const FORMAT = z.enum(['vertical', 'feed45', 'square', 'landscape']).describe('vertical = 9:16, feed45 = 4:5, square = 1:1, landscape = 1.91:1');
const ID = z.string().min(3).max(120);
const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export const TOOL_NAMES = ['whoami', 'brand_pack', 'list_ads', 'get_ad', 'feedback_inbox', 'create_ad', 'request_upload_urls', 'save_version', 'save_pending_version',
  'add_feedback', 'decide_feedback', 'regenerate_ad', 'revert_ad', 'list_slack_channels', 'post_to_slack', 'higgsfield_usage', 'higgsfield_generate', 'higgsfield_status'] as const;

export function buildMcpServer(db: SupabaseClient, actor: Actor, appUrl: string, call: Call = (m, p, b, q) => handle(db, actor, m, p, b ?? null, new URLSearchParams(q || {}), appUrl)) {
  const s = new McpServer({ name: 'yoke-ad-studio', version: '1.0.0' }, {
    instructions: 'Yoke Ad Studio is the team\'s shared ad library. You act as the signed-in member with their permissions. ' +
      'Read brand_pack before writing copy. Owners (and Shane as admin) change their own ads; everyone can read and comment. ' +
      'Saving is not approval; final approval happens in the app. Never invent ids or links: report only what tools return. ' +
      'higgsfield_generate costs money and post_to_slack posts publicly: ask the person first, every time.',
  });
  const reg = (name: string, cfg: { title: string; description: string; inputSchema?: z.ZodRawShape; annotations: Record<string, boolean> }, cb: (args: any) => Promise<unknown>) =>
    s.registerTool(name, { title: cfg.title, description: cfg.description, inputSchema: cfg.inputSchema ?? {}, annotations: { title: cfg.title, ...cfg.annotations } }, (args: any) => run(() => cb(args)));

  reg('whoami', { title: 'Who am I', description: 'Your Ad Studio name and role (viewer, creator, approver or admin).', annotations: READ }, () => call('GET', ['me']));
  reg('brand_pack', { title: 'Yoke brand pack', description: 'Voice, allowed product claims, CTA and visual rules. Read before writing any ad.', annotations: READ }, () => call('GET', ['brand']));
  reg('list_ads', { title: 'List ads', description: 'Ads in the shared library, newest first.', inputSchema: { mine: z.boolean().optional().describe('Only ads you own') }, annotations: READ },
    a => call('GET', ['assets'], null, a.mine ? { mine: '1' } : {}));
  reg('get_ad', { title: 'Get an ad', description: 'One ad with every version (short-lived media/source URLs), the full attributed feedback thread with decisions, and whether you can manage it.',
    inputSchema: { asset_id: ID }, annotations: READ }, a => call('GET', ['assets', a.asset_id]));
  reg('feedback_inbox', { title: 'Feedback inbox', description: 'Ads you own with feedback waiting for your approve/reject. Admins may pass scope "all".',
    inputSchema: { scope: z.enum(['mine', 'all']).optional() }, annotations: READ }, a => call('GET', ['inbox'], null, { scope: a.scope || 'mine' }));

  reg('create_ad', { title: 'Create an ad', description: 'Start a new ad you own (no media yet). Then request_upload_urls and save_version.',
    inputSchema: { concept_name: z.string().min(1).max(200), kind: z.enum(['static', 'motion', 'video']), format: FORMAT }, annotations: WRITE },
    a => call('POST', ['assets'], { concept_name: a.concept_name, kind: a.kind, format: a.format }));
  reg('request_upload_urls', { title: 'Get upload URLs', description: 'Short-lived signed PUT URLs for media, poster and editable source files, scoped to one ad you own. ' +
      'Upload the real bytes with the given content-type, then call save_version with the returned paths. Report the true type; never rename WebM to MP4.',
    inputSchema: { asset_id: ID, files: z.array(z.object({ name: z.string().max(80), content_type: z.string().max(60) })).min(1).max(10) }, annotations: WRITE },
    a => call('POST', ['assets', a.asset_id, 'uploads'], { files: a.files }));
  reg('save_version', { title: 'Save a version', description: 'Create the next version from uploaded files. The server checks the bytes exist with the claimed type. ' +
      'For revisions pass parent_version_id: a newer version saved by someone else is refused (conflict), never overwritten. Same idempotency_key returns the same version.',
    inputSchema: {
      asset_id: ID, file_path: z.string().max(300), content_type: z.string().max(60), poster_path: z.string().max(300).optional(), editable_path: z.string().max(300).optional(),
      parent_version_id: ID.optional(), revision_note: z.string().max(1000).optional(), width: z.number().int().positive().max(10000).optional(), height: z.number().int().positive().max(10000).optional(),
      duration_sec: z.number().positive().max(600).optional(), copy: z.record(z.string(), z.any()).optional(), source: z.record(z.string(), z.any()).optional(),
      qa: z.array(z.record(z.string(), z.any())).max(30).optional(), idempotency_key: z.string().min(8).max(120),
    }, annotations: { ...WRITE, idempotentHint: true } },
    ({ asset_id, ...b }) => call('POST', ['assets', asset_id, 'versions'], b));
  reg('save_pending_version', { title: 'Save a pending version', description: 'Record an unfinished render or brief honestly as Pending (no media). Not a finished ad.',
    inputSchema: { asset_id: ID, note: z.string().min(1).max(1000), spec: z.record(z.string(), z.any()).optional(), idempotency_key: z.string().min(8).max(120) }, annotations: { ...WRITE, idempotentHint: true } },
    a => call('POST', ['assets', a.asset_id, 'versions'], { render_state: 'pending', render_note: a.note, spec: a.spec ?? null, idempotency_key: a.idempotency_key }));

  reg('add_feedback', { title: 'Add feedback', description: 'Comment on a specific version under your own name. Works on teammates\' ads too.',
    inputSchema: { asset_id: ID, version_id: ID, body: z.string().min(1).max(4000), at_sec: z.number().min(0).max(600).optional() }, annotations: WRITE },
    a => call('POST', ['assets', a.asset_id, 'comments'], { version_id: a.version_id, body: a.body, at_sec: a.at_sec ?? null }));
  reg('decide_feedback', { title: 'Approve or reject feedback', description: 'Owner/admin only. Approve = include this item in the next version; reject = set it aside (with an optional reason); undecided = undo. ' +
      'This is not final approval of the ad.',
    inputSchema: { asset_id: ID, feedback_id: ID, decision: z.enum(['approved', 'rejected', 'undecided']), reason: z.string().max(1000).optional() }, annotations: WRITE },
    a => call('POST', ['assets', a.asset_id, 'feedback', a.feedback_id, 'decide'], { decision: a.decision, reason: a.reason ?? null }));
  reg('regenerate_ad', { title: 'Regenerate ad', description: 'Owner/admin only. Queues the next version from every approved, open feedback item at this moment (plus an optional note). ' +
      'Claude starts it on the next scheduled run; report it as queued, not done.',
    inputSchema: { asset_id: ID, note: z.string().max(2000).optional() }, annotations: WRITE },
    a => call('POST', ['assets', a.asset_id, 'process-approved'], { note: a.note ?? null }));
  reg('revert_ad', { title: 'Revert to a version', description: 'Owner/admin only. Saves a new version that copies an older one. Refused if a newer version appeared meanwhile.',
    inputSchema: { asset_id: ID, from_version_id: ID, expected_latest_version_id: ID }, annotations: WRITE },
    a => call('POST', ['assets', a.asset_id, 'revert'], { from_version_id: a.from_version_id, expected_latest_version_id: a.expected_latest_version_id }));

  reg('list_slack_channels', { title: 'Slack channels', description: 'Channels the Yoke Slack app is in. Use only a channel the person names.', annotations: READ }, () => call('GET', ['slack', 'channels']));
  reg('post_to_slack', { title: 'Post to Slack', description: 'Owner/admin only. Posts this exact version to a Slack channel for review; replies come back as feedback. ' +
      'Visible to the channel. Ask the person and name the channel before calling. Retrying with the same request_id never posts twice.',
    inputSchema: { asset_id: ID, version_id: ID, channel_id: z.string().min(5).max(40), question: z.string().max(500).optional(), request_id: z.string().min(8).max(80),
      person_confirmed: z.literal(true).describe('true only after the person said yes to posting this version to this channel in this conversation') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    a => call('POST', ['assets', a.asset_id, 'share'], { version_id: a.version_id, channel_id: a.channel_id, question: a.question ?? null, idempotency_key: `mcp-${actor.user_id}-${a.request_id}` }));

  reg('higgsfield_usage', { title: 'Higgsfield usage', description: 'Seconds of Higgsfield video generated this month, the optional cap, and allowed lengths.', annotations: READ }, () => call('GET', ['higgsfield', 'usage']));
  reg('higgsfield_generate', { title: 'Generate Higgsfield video (paid)', description: 'Creators only. ONE billable Seedance 2.5 render through Ad Studio\'s server account, saved as a Rendering version. ' +
      'Before calling: show length, format, sound and this month\'s usage, and get a yes for this exact render. Never call again to retry: the same arguments return the same render.',
    inputSchema: { prompt: z.string().min(1).max(4000), seconds: z.number().int().min(4).max(12), format: FORMAT, sound: z.boolean(),
      asset_id: ID.optional().describe('Add a version to an ad you own'), concept_name: z.string().max(70).optional(),
      person_confirmed: z.literal(true).describe('true only after the person approved this exact length/format/sound render in this conversation') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    a => {
      const key = 'mcp-' + createHash('sha256').update(JSON.stringify([actor.user_id, a.asset_id || a.concept_name || '', a.prompt, a.seconds, a.format, a.sound])).digest('hex').slice(0, 40);
      return call('POST', ['higgsfield', 'generate'], { prompt: a.prompt, duration: a.seconds, format: a.format, audio: a.sound, asset_id: a.asset_id ?? null, concept_name: a.concept_name, idempotency_key: key });
    });
  reg('higgsfield_status', { title: 'Higgsfield render status', description: 'Check a render once. The server saves the playable video as the version when it is ready.',
    inputSchema: { job_id: z.string().uuid() }, annotations: READ }, a => call('GET', ['higgsfield', 'status'], null, { job: a.job_id }));
  return s;
}
