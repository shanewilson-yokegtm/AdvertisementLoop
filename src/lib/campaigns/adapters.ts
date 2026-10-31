import type { Channel, ChannelPlan } from './contracts';

export type ExecutionStep = 'build_paused' | 'verify_paused' | 'activate';
export type PlatformState = 'absent' | 'paused' | 'active' | 'partial' | 'unknown';

/** Thrown by an adapter only when the platform definitively rejected the call and nothing was created or changed
 * (e.g. a validation error before any write). Every other error, including timeouts, is treated as `unknown`. */
export class DefiniteFailure extends Error {
  constructor(message: string, public evidence: Record<string, unknown> = {}) { super(message); }
}

/** Implement behind the authenticated server/worker (src/lib/server/campaign-executor.ts drives it).
 * Every external mutation is claimed in the durable step ledger BEFORE the call; an unknown result is reconciled
 * through `reconcile`, never blindly retried. `operationId` is stable per authorization/channel/step and should be
 * sent to the platform where it supports idempotency keys or labels, so reconciliation can find the effect.
 * No live adapter is registered in this scaffold. */
export interface CampaignAdapter {
  channel: Channel;
  preflight(plan: ChannelPlan): Promise<{ ready: boolean; evidenceRefs: string[]; blockers: string[] }>;
  buildPaused(plan: ChannelPlan, operationId: string): Promise<{ platformIds: Record<string, string>; receiptRef: string }>;
  verifyPaused(platformIds: Record<string, string>, plan: ChannelPlan): Promise<{ matches: boolean; previewRefs: string[]; differences: string[] }>;
  activate(platformIds: Record<string, string>, authorizationId: string, operationId: string): Promise<{ state: 'active' | 'partial' | 'unknown'; receiptRef: string }>;
  /** Read-only lookup of what the platform holds for this operation. Used as before-state evidence and to resolve unknowns. */
  reconcile(operationId: string, step: ExecutionStep): Promise<{ state: PlatformState; evidenceRefs: string[]; platformIds?: Record<string, string> }>;
  observe(platformIds: Record<string, string>): Promise<{ observedAt: string; settings: ChannelPlan; evidenceRef: string; editor: string | null }>;
}

export const registeredAdapters: Partial<Record<Channel, CampaignAdapter>> = Object.freeze({});
