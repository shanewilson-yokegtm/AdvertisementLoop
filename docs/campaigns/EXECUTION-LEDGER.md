# Execution ledger and launch rehearsal

Status: implemented and tested locally. Migration `20261031001000_campaign_execution_ledger.sql` is unapplied. No adapter is registered, nothing routes to the executor, and `attempt_launch` still records a blocker. No network or account call exists in this code path.

## What it guarantees

- **One identity per step.** `operation_id = yx_ + sha256(launchId, channel, step)`. At most one `build_paused`, `verify_paused` and `activate` row per authorization and channel.
- **Claim before calling out.** `campaign_step_claim` stores the payload hash, before-state (read-only platform lookup plus account preflight), worker and lease before the adapter is called. Concurrent claims serialize on an advisory lock; one worker wins. A different payload for the same operation is refused.
- **Preflight twice.** `adapter.preflight` must return ready with at least one account evidence reference before the build and again immediately before activation. Both results are stored in the step's before-state.
- **Fresh readback under the activation claim.** After claiming `activate`, the worker reads the paused build again. The result is appended to the log before any call. Drift completes the step as `blocked` (no external call was made) and is not retried under this authorization.
- **Unknown stays unknown.** A timeout or any error other than `DefiniteFailure` is `unknown`, and so is an expired lease. `reconcileStep` releases a step for retry (`absent`) only with authoritative evidence: `terminalNoEffect` from the provider, documented `providerIdempotency` for that step, or a read-only step. A point-in-time "not found" while a request may be in flight stays `unknown`. The database enforces the same rule.
- **Channel binding.** `reconcileStep` refuses an adapter whose channel differs from the recorded step.
- **Rechecks.** Before each step the worker requires `launch_authorized`, approval and authorization matching the current plan fingerprint, the same launch id, unexpired authorization and spending window, and ready, approved assets. The claim function repeats the plan/authorization/expiry check in the database. `verify_paused` needs a recorded build; `activate` needs a recorded matching readback.
- **Fence.** A trigger on `campaign_records` refuses memo, approval or authorization changes, and closing, while any step is `claimed` or `unknown`. Once a channel is activated, memo/approval/authorization changes are refused; changing a live campaign needs a separate workflow.
- **Audit.** Every transition and pre-call check is appended to `campaign_execution_log` (no update/delete). Step rows cannot be deleted. Members read; only the service role calls the functions; connector tokens cannot read.

## Tests (`tests/campaigns/executor.test.mjs`)

Real PGlite with all migrations, the real API and executor, an in-memory fake platform. Covered: disconnected production wiring; happy path and repeated runs; concurrent workers and simultaneous claims; crash after effect; dead-worker lease; timeout, partial and definite rejection; late-landing request after an early "not found" (stays unknown, then reconciles as applied, one entity); preflight not ready, without evidence, or failing only before activation; readback drift between verification and activation; wrong-channel reconcile; memo/approval changes attempted after the claim and before the external call, while unknown, and after activation; stale authorization, unready asset, changed memo; server-only access and append-only history. Removing the fence, the terminal-evidence rule or the fresh readback each makes these tests fail.

## Remaining limits before live use

1. **Migration and wiring.** The ledger migration is unapplied. Nothing calls `executeLaunch`; `attempt_launch` stays blocked. A server-only worker/route, its service authentication and the `attempt_launch` hand-off need Shane's review.
2. **Real adapters.** None exist. Each needs: `operationId` sent as a provider idempotency key or label so lookups can find effects; `terminalNoEffect` only from an authoritative provider status; a `providerIdempotency` entry only with a documentation reference; `DefiniteFailure` only when the provider confirms nothing was written.
3. **Readback-to-activation window.** The fresh readback narrows but cannot close the gap before the activation request reaches the platform. A colleague edit in that window is caught only by post-launch observation (`observe`), which is not yet scheduled.
4. **Partial and ambiguous outcomes.** These stay `unknown` until a person resolves them; there is no UI or tool for that yet.
5. **Superseded paused builds.** Changing the memo after a paused build (not activated) is allowed; the old paused entities remain on the platform and need cleanup.
6. **Live changes.** There is no change workflow for an activated campaign; the fence refuses plan changes instead.
7. **Lease vs. call duration.** Leases must exceed the step timeout; a worker that overruns its lease turns the step `unknown` (safe, but needs reconciliation).
