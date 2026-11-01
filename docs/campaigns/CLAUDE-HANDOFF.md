# Campaign operator: Claude handoff

Status: code scaffold on `feature/campaign-operator`, based on AdvertisementLoop main `6ab9273`. No firm accounts connected, no migration applied remotely, no ad spend, live launch or scheduled job enabled. Use the PR head as the source of truth for this work.

## Product process

Someone asks to start a campaign → Claude asks consequential questions and proposes defaults → shared one-page memo → approval → “go, launch it” → consistent build/labels/tracking → integrated dashboard → learning review at the memo’s analysis date.

One initiative may produce a Meta and a LinkedIn campaign. Exact concepts and creative versions link them. A colleague may build manually; imported observations and metrics use the same reporting process, with explicit provenance.

## Implemented and locally verifiable

- `skills/campaign-operator/`: dialogue, default/exception rules, approval/launch process, audit and closeout guidance. No API model subscription required for this skill.
- `src/lib/campaigns/contracts.ts`: strict memo, channel plan, observations, metric batches and command schemas.
- `playbook.ts`: versioned defaults, deterministic fingerprint/names/tags and readable memo generation. Asset-version tags remain stable across reuse.
- `workflow.ts`: shared planning notes, complete memo, approver-only approval/launch authorization, expiration, invalidation and disconnected launch attempt. All creators can collaborate on a campaign; the original owner remains named.
- `reporting.ts`: captured-plan audit, corrected ad/day imports, explicit unknown outcomes and conflict handling, comparisons and closeout evidence. No live data implied.
- `adapters.ts`: the interface for Meta/LinkedIn or browser-based execution. Registry is intentionally empty; it is not wired into a live executor.
- `src/lib/server/campaign-api.ts`: personal API and browser-session API share one handler and atomic service-only database RPC.
- `/campaigns`: campaign list/create; memo, execution, audit, performance grouping/date filters and closeout views.
- `src/lib/campaigns/mcp.ts`: nine tools registered in the existing per-user OAuth MCP server source; deployment/connection must still be verified.
- Local migration: campaign state, immutable event snapshots, observations, metric batches, role-based reads, no direct browser writes, CAS and idempotency.
- `tests/campaigns/`: no-network fixtures and real PGlite/API tests including roles, replay, edits, launch blocking, manual evidence and reporting.

## First integration steps in the team Claude environment

1. Check out this branch/PR; read AGENTS.md, this file and `skills/campaign-operator/SKILL.md`. Reconcile against the latest main before merge. Do not overwrite the parallel `integration-review` work.
2. The latest main already contains the per-person OAuth MCP connector. This branch registers `registerCampaignTools` on that authenticated `buildMcpServer` with the same verified `db` and `actor`, and includes campaign tools in the inventory. Verify the hosted OAuth connection and tool discovery after deployment. Keep one auth boundary; never introduce a shared admin header or credential. The personal-token API also routes `/api/v1/campaigns` for advanced local clients.
3. Review and apply `supabase/migrations/*_campaign_operator.sql` through Yoke’s approved migration process. It is unapplied. Inspect the target schema and merge order first. Do not copy or replay Rumi migrations. Deploy application code only after the migration is available.
4. Install/replace the campaign skill in the team Claude environment. Verify the installed package targets this project and exposes the connected tools; a GitHub push alone does not update installed skills.
5. Rehearse the actual GTME waitlist conversation; agree the offer, qualification/agency rule, markets, budget, outcomes, concepts and account identities. Fixture IDs are unusable placeholders. Save open decisions as planning notes.
6. Connect the firm’s actual Meta and LinkedIn access, plus the authoritative waitlist outcome source. Verify account IDs, roles, geography, currency/timezone, tracking eligibility and exact asset previews before enabling live execution.
7. The durable external-step ledger and a no-network executor rehearsal are implemented (see `EXECUTION-LEDGER.md`); implement each adapter against it before registering it. Keep a single launch operation per authorization. Each step needs an intended payload hash, before state, operation ID and after receipt. Reconcile partial/unknown responses before retrying. Recheck current approval, authorization expiry, asset readiness, live-state drift and remaining budget before activation. Never merely change `capabilities()` to true.
8. Add account discovery, platform configuration/readback and reporting readers, including manually built campaigns. Preserve platform IDs, observed timestamps and available editor evidence. Unclassified concepts stay visible. Actual platform provenance is not enabled by the import API; add it only on trusted server readers.
9. Add a scheduler for due closeout work after deciding hosting and service authentication. `GET /campaigns/due` is only a queue query. Separate spending end, outcome-maturity date and human review; save the evidence-based final memo through `close`. Recommendations do not execute another campaign.

## Remaining scope and limits

- No live Meta/LinkedIn adapter, browser executor, account discovery, credential configuration or provider reporting reader is implemented.
- No new audience-management product: each channel plan captures the audience and its version; reusable library extraction can follow actual campaign needs.
- The memo generator does not itself create a native document/PDF. It returns concise Markdown and a rendered review view.
- Asset readiness/dimensions and approval are checked at memo approval/launch authorization; live worker must recheck before spend. Creative generation and format adaptation are handled through existing ad-builder workflows; real placement checks require firm connections.
- Imports are labelled manual, including user-supplied editor labels. They cannot prove historical changes between observations. Audit snapshots preserve intent at import time, not an invented plan from before the campaign existed.
- Report storage is immutable import batches, limited to 1,000 rows per batch and 500 batches per campaign read. Same stable sourceKey + ad/day is latest-wins; omitted rows are unchanged (send explicit zeros/nulls to correct a row); overlapping different streams are rejected as conflicting. Current API refuses oversized report scans instead of silently truncating. Implement database-backed paging/aggregation before scaling.
- First-party counts rely on a declared deduplicated one-person/one-deployment assignment. This scaffold does not resolve cross-channel identity. Do not sum independently attributed conversions as people.
- The UI compares concepts within a selected campaign. Cross-campaign portfolio reporting, an arbitrary comparison builder, automated recommendations and autonomous budget changes are not implemented.
- JSON observations retain settings and source references; they do not store raw contact lists or tokens. Do not paste credentials into a memo/import/skill conversation.
- Audit/event list UI shows the latest 100 entries and declares truncation. Use complete event paging before a high-volume compliance/audit claim.
- Closing freezes new commands; corrections after close require a separately designed amendment flow. Do not promise live report revisions after closure.

## Verification

Run `npm ci`, `npm run test:campaigns`, `npm test`, `npm run typecheck`, `npm run build`.

The new integration tests run all migrations in local PGlite and verify the service handler through the same query shapes as Supabase. They do not prove hosted OAuth, remote migration state, native platform controls, ad delivery or scheduler operation. Those are explicit handoff checks.

## Suggested continuation prompt

“Continue the campaign-operator scaffold in this PR. Read docs/campaigns/CLAUDE-HANDOFF.md and AGENTS.md. Keep the agreed conversational workflow. First reconcile the current main, run the local checks, and identify the exact Yoke firm account connections needed. Connect reporting and paused-build capability before enabling live launch. Preserve exact-plan approvals, duplicate prevention, missing-data states and manual-campaign audit support. Do not claim launch or scheduled analytics until verified.”

Metric dates are delivery/cohort days in the memo timezone. Delayed first-party outcomes must be assigned back to that deployment/day rather than added as a second person on the receipt date. Attribution models remain separate rows in cross-channel comparisons.
