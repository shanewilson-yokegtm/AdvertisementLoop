# Execution ledger and launch rehearsal

Status: implemented and tested locally. Migration `20261031001000_campaign_execution_ledger.sql` is unapplied. No adapter is registered, nothing routes to the executor, and `attempt_launch` still records a blocker. No network or account call exists in this code path.

## What it guarantees

- **One identity per step.** `operation_id = yx_ + sha256(launchId, channel, step)`. At most one `build_paused`, `verify_paused` and `activate` row per authorization and channel.
- **Claim before calling out.** `campaign_step_claim` stores the payload hash, before-state (read-only platform lookup plus account preflight), worker and lease before the adapter is called. Concurrent claims serialize on an advisory lock; one worker wins. A different payload for the same operation is refused.
- **Preflight twice.** `adapter.preflight` must return ready with at least one account evidence reference before the build and again immediately before activation. Both results are stored in the step's before-state.
- **Fresh readback under the activation claim.** After claiming `activate`, the worker reads the paused build again, then rechecks authorization, expiry, spending window and assets, then records the gate (`campaign_step_evidence`), which re-validates the authorization and spending window in the database. Only then is `activate` called. Drift, expiry or revocation during the readback completes the step as `blocked` (no external call was made); it is not retried under this authorization.
- **Unknown stays unknown.** A timeout or any error other than `DefiniteFailure` is `unknown`, and so is an expired lease. `reconcileStep` releases a step for retry (`absent`) only with authoritative evidence: `terminalNoEffect` from the provider, documented `providerIdempotency` for that step, or a read-only step. A point-in-time "not found" while a request may be in flight stays `unknown`. The database enforces the same rule.
- **Channel binding.** `reconcileStep` refuses an adapter whose channel differs from the recorded step.
- **Rechecks.** Before each step the worker requires `launch_authorized`, approval and authorization matching the current plan fingerprint, the same launch id, unexpired authorization and spending window, and ready, approved assets. The claim function repeats the plan/authorization/expiry check in the database. `verify_paused` needs a recorded build; `activate` needs a recorded matching readback.
- **Fence.** A trigger on `campaign_records` refuses changes to the memo, the approval, the whole launch authorization object (id, status, expiry, blockers) or the campaign status, and refuses closing, while any step is `claimed` or `unknown`. Once a channel is activated, those changes (other than closing) are refused; changing a live campaign needs a separate workflow. Notes, observations and metric imports are unaffected.
- **Audit.** Every transition and pre-call check is appended to `campaign_execution_log` (no update/delete). Step rows cannot be deleted. Members read; only the service role calls the functions; connector tokens cannot read.

## Tests (`tests/campaigns/executor.test.mjs`)

Real PGlite with all migrations, the real API and executor, an in-memory fake platform. Covered: disconnected production wiring; happy path and repeated runs; concurrent workers and simultaneous claims; crash after effect; dead-worker lease; timeout, partial and definite rejection; late-landing request after an early "not found" (stays unknown, then reconciles as applied, one entity); preflight not ready, without evidence, or failing only before activation; readback drift between verification and activation; authorization expiry (worker clock and database clock) and asset revocation during the fresh readback, with zero activate calls; `attempt_launch` or a direct expiry rewrite under an unresolved step; wrong-channel reconcile; memo/approval changes attempted after the claim and before the external call, while unknown, and after activation; stale authorization, unready asset, changed memo; server-only access and append-only history. Removing the fence (or narrowing it to the launch id), the terminal-evidence rule, the fresh readback, the post-readback recheck or the database gate each makes these tests fail.

## Remaining limits before live use

Code and schema
1. The ledger migration is unapplied. Nothing calls `executeLaunch`; `attempt_launch` stays blocked.
2. **Worker.** A server-only worker or route, its service authentication, lease sizing (lease must exceed the step timeout) and the `attempt_launch` hand-off need building and Shane's review.
3. **Closeout scheduler.** `GET /campaigns/due` is a query only; no scheduler runs closeout reviews.
4. **Resolution UI.** `unknown` and partial outcomes wait for a person; there is no tool or screen to resolve them yet.
5. **Superseded paused builds.** A memo change after a paused (not activated) build is allowed; old paused entities need cleanup. Live campaigns have no change workflow; the fence refuses instead.

Per real adapter (none exist)
6. **Account, identity, tracking and budget checks** in `preflight`, from the real accounts: ad account ID and role, currency/timezone, page/organization identity, pixel/dataset/Insight Tag and waitlist event eligibility, destination and UTM tags, budget and schedule.
7. **Provider hard spending limits** set on the account/campaign (account spending limit, campaign lifetime cap) so a duplicate or runaway effect is bounded by the platform, not only by this code.
8. **Idempotency and lookup.** `operationId` sent as a provider idempotency key or label; `terminalNoEffect` only from an authoritative provider status; `providerIdempotency` only with a documentation reference; `DefiniteFailure` only when the provider confirms nothing was written.
9. **Confirmed post-activation readback.** After `activate`, read the live entity back (status, budget, targeting, creatives) and record it; today the activation receipt is the adapter's response only.
10. **Trusted reporting readers.** Server-side platform and waitlist readers with real provenance; imports are manual today.

Residual races (documented, not closable in code)
11. The fresh readback and gates narrow but cannot remove the window between the database gate and the provider applying `activate`; an expiry, revocation or colleague edit in that window is caught only by post-activation readback (item 9) and observation.
12. Platform-side edits after activation are outside this ledger; only scheduled observation can detect them.
