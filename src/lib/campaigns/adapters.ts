import type { Channel, ChannelPlan } from './contracts';

/** Implement behind the authenticated server/worker. Browser and API executors use the same contract.
 * Every external mutation needs a durable step receipt BEFORE a call; an unknown result must be reconciled,
 * never blindly retried. No live adapter is registered in this scaffold. */
export interface CampaignAdapter {
  channel: Channel;
  preflight(plan: ChannelPlan): Promise<{ ready: boolean; evidenceRefs: string[]; blockers: string[] }>;
  buildPaused(plan: ChannelPlan, operationId: string): Promise<{ platformIds: Record<string, string>; receiptRef: string }>;
  verifyPaused(platformIds: Record<string, string>, plan: ChannelPlan): Promise<{ matches: boolean; previewRefs: string[]; differences: string[] }>;
  activate(platformIds: Record<string, string>, authorizationId: string, operationId: string): Promise<{ state: 'active' | 'partial' | 'unknown'; receiptRef: string }>;
  reconcile(operationId: string): Promise<{ state: 'absent' | 'paused' | 'active' | 'partial' | 'unknown'; evidenceRefs: string[] }>;
  observe(platformIds: Record<string, string>): Promise<{ observedAt: string; settings: ChannelPlan; evidenceRef: string; editor: string | null }>;
}

export const registeredAdapters: Partial<Record<Channel, CampaignAdapter>> = Object.freeze({});
