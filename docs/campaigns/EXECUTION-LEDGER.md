# Execution ledger and launch rehearsal

Status: implemented and tested locally. Migration `20261031001000_campaign_execution_ledger.sql` is unapplied. No adapter is registered, nothing routes to the executor, and `attempt_launch` still records a blocker. No network or account call exists in this code path.

## What it guarantees

- **One identity per step.** `operation_id = yx_ + sha256(launchId, channel, step)`. Each launch authorization has at most one `build_paused`, `verify_paused` and `activate` row per channel (primary key + unique constraint).
- **Claim before calling out.** `campaign_step_claim` stores the intended payload hash, read-only before-state evidence, worker and lease in the database before the adapter is called. Concurrent claims serialize on an advisory lock; only one worker gets `claimed: true`.
- **Same step, same payload.** A second claim with a different payload hash for the same operation is refused, not overwritten.
- **Unknown is a real state.** A timeout or any error that is not a `DefiniteFailure` is recorded as `unknown`. An expired lease with no outcome becomes `unknown` on the next claim. Unknown steps never re-run; `reconcileStep` looks the operation up on the platform (read-only). Applied → `succeeded` with the evidence; proven absent → `absent`, which allows a new attempt; still ambiguous (for example partial activation) → stays `unknown` for a person.
- **Rechecks before each step and before activation.** The worker reloads the campaign and requires: status `launch_authorized`, approval and authorization fingerprints equal to the current plan, the same launch id, unexpired authorization and spending window, and approved/ready assets with declared dimensions. The claim function repeats the plan/approval/authorization/expiry check in the database.
- **Order enforced in the database.** `verify_paused` needs a recorded build; `activate` needs a recorded paused readback whose receipt says `matches: true`.
- **Audit.** Every transition is appended to `campaign_execution_log`, which cannot be updated or deleted; ledger rows cannot be deleted. Members can read; only the service role can call the functions; OAuth connector tokens cannot read.

## Tests (`npm run test:campaigns`, `tests/campaigns/executor.test.mjs`)

Real PGlite with all migrations, the real API and executor, and an in-memory fake platform:

- production wiring: empty adapter registry blocks; `attempt_launch` still blocks; no ledger rows
- happy path and repeated commands: build/verify/activate each called once; a second run reuses receipts
- concurrency: a second worker sees `in_progress` while the first holds the build; three simultaneous claims → one winner; changed payload refused
- crash after effect: lost response → `unknown`; rerun refuses; reconcile finds it applied; resume activates without rebuilding. Dead worker lease → `unknown` → proven absent → attempt 2
- timeout and partial activation → `unknown`; partial stays unknown after reconcile; definite rejection → `failed`, not retried
- stale authorization, unready asset, mismatched readback and changed memo all stop before activation, in the worker and in the database
- permissions and append-only history

## Before any live use

1. Apply the migration through the approved process (`ACCOUNT-ACCESS.md`, change 1).
2. Implement a real adapter for one channel. `reconcile` must find effects by `operationId` (platform idempotency key, name or label), and `DefiniteFailure` may be thrown only when the platform confirms nothing was written.
3. Add a server-only trigger (worker or authenticated route) that runs `executeLaunch` after `authorize_launch`, and change `attempt_launch` to hand off to it. That change and the adapter registration need Shane's review; neither is in this branch.
4. Rehearse against paused builds in the firm accounts with activation disabled before allowing `activate`.
