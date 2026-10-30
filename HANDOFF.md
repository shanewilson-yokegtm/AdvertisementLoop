# Yoke Ad Studio handoff (updated Oct 30, 2026, morning PT)

Paste this into a new chat to continue. Repo: `/home/claude/advertisementloop` (GitHub `shanewilson-yokegtm/AdvertisementLoop`, branch `main`, pushes auto-deploy to Vercel).
Live app: https://advertisementloop-eight.vercel.app · Supabase project `uevktzprbpymfcquotmb` · Vercel team `yoke-gtm`, project `advertisementloop`.

## Standing rules (from Shane)
- No generation spend or ad budget without an approved cost allocation. Shane has approved members pressing Generate in the app. Claude runs no billable test renders unless he asks.
- Secrets live only in Vercel (`SUPABASE_SERVICE_ROLE_KEY`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `HF_CREDENTIALS`, `APP_URL`). Never ask for keys in chat, and never print, log or commit them.
- No Rumi resources. No posting to Slack channels other than `#yoke-creative-review` (C0CDCK34PL2). Don't message Teng.
- Supabase `apply_migration` shows Shane an approval card. Tell him with SendUserMessage before calling it. After applying, rename the local migration file to the version Supabase recorded (`list_migrations`).
- Don't claim success without verification. Report what remains unverified.

## Current state (Oct 30)
- Production = `main` at 719a8e4. Nothing below is deployed.
- Review branch `integration-review` (draft PR for Codex review): design pass 9779ba4, Codex's reliability patch c5635e6
  (Higgsfield save recovery, Slack retries, feedback API context, self-contained skill packaging), one-card-per-asset
  Library fix, the account-based Claude connector (MCP + Supabase OAuth 2.1, built but OFF), Higgsfield
  Regenerate from approved feedback, and skill/plugin 0.4.0.
- Two migrations wait for approval: `20261030090000_mcp_oauth_guard`, `20261030091000_higgsfield_revisions`.
- Connector setup steps for Shane are in README › *Claude connector setup*. Do not enable OAuth, register clients,
  set the hook or env vars without his approval. Never share an admin token in a connector header.
- The personal-token CLI is now the advanced path (Claude Code). Claude chat needs the connector; until it's on,
  the skill can't save from chat (it says so and points to the app).
- Still unverified: a real paid Higgsfield render end-to-end (needs Shane's OK for one 4 s 720p test), the OAuth
  flow against live Supabase (server is disabled), Claude's handling of the `resource` parameter.

## Shipped Oct 29 evening (history; the asset page has since been redesigned on the review branch)
- "Only feedback" redesign: migration applied (20261030033828), merged and deployed (fa10d62).
- Asset page action row is only Share / Download / Approve vN (Shane). Reject ad and Editable source moved into "Copy, checks and file". Iterate, Upload and Suggest buttons removed.
- Higgsfield for skills: `/api/v1/higgsfield/{generate,status,usage}` (+ `revise` on the review branch). `adstudio.py higgsfield|hf-status|hf-usage|hf-revise`. The skill confirms length and seconds-used before each render. The third-party Higgsfield MCP connector can't generate; skills use Ad Studio's server integration.
- Skills are packaged by `scripts/package-skills.py` (plugin 0.4.0 on the review branch). Installed copies must be replaced explicitly; publishing to the org needs Shane.

## Earlier: "only feedback" redesign (now deployed; history below)

Shane's request (8:28pm): "there is only feedback, no comments AND feedback. I go through, I approve or reject the feedback, then when I hit process the task is to process all of the approved feedback in the next pass."

**Why his last edits missed feedback (diagnosis):** on Clay Output 9x16, the v3→v4 round captured feedback when the review draft was started (22:43 UTC). Shane's "Request changes" note at 22:53 (fuse, then explode into clay) arrived after that snapshot. It was treated as "late" and left out, so v4 only applied Henry's hand-kneading comment. Two more problems:
- "Request changes" wrote both a review note and a comment, which created duplicate entries.
- Feedback and comments were two separate places.

Two open items still wait on that ad: the 22:53 fuse/explode note on v3, and the 03:26 UTC "hand is creepy, burst pipe, rainbow collapses" note on v4.

**Done locally (written; tests passed before the interruption):**
1. Migration `supabase/migrations/20261030033828_feedback_approve_process.sql` (applied 2026-10-30 03:38 UTC):
   - Adds `comments.decision` ('approved' or null), `decided_by` and `decided_at`; the guard allows those columns to change.
   - `feedback_decide(p_comment, p_decision approved|rejected|undecided, p_reason, p_actor)`:
     - Only the owner or an admin can call it.
     - Rejected → status `dismissed` with the reason. Undecided → reopens the item.
     - Refused if the item is already in a version being made.
   - `feedback_process(p_asset, p_note, p_actor)`:
     - Takes ALL open, approved items on the ad, from any version, at the moment of pressing (no snapshot).
     - Cancels old `reviewing` drafts.
     - Creates a `processing` row with status `approved`, built on the latest version, with decisions = apply.
     - Reopens an approved ad and queues a `revision_jobs` row.
     - Refused while a version is already being made.
   - Tests in `supabase/tests/ownership.test.mjs`: 115 passing.
2. `src/components/Process.tsx` rewritten:
   - "Feedback to decide · N" with Approve / Reject per item, saved immediately via the RPC.
   - Optional "Anything else to change" note.
   - **Process approved feedback** button.
   - Shows queued/executing state with Cancel.
3. `src/app/a/[id]/page.tsx`:
   - One **Feedback on vN** box (voice or text, at-playhead option, **Add feedback**) placed under the actions.
   - The Review panel's "Request changes" textarea is removed. What remains: an **Approve vN** button for approvers and **Reject ad** for owners.
   - The history section is titled "Decided feedback", with chips Approved in vN / Rejected / Approved · waiting.
4. `src/lib/data.ts`: `Comment.decision` added.
5. API (`src/lib/server/api.ts`): `POST assets/:id/feedback/:fid/decide {decision, reason}` and `POST assets/:id/process-approved {note}`.
6. Skill helper (`skills/yoke-ad-maker/scripts/adstudio.py`): commands `decide` and `process-approved`. `SKILL.md` feedback section rewritten for the new flow.
7. `creative/REVISIONS.md` (worker playbook): address EVERY item in `comment_ids`, check each one against the render, the newest item wins on conflict, and the revision_note covers each item.
8. `supabase/tests/rollout.test.mjs` updated for the new UI: 18 passing.

**Saved on branch `feedback-approve-process`** (pushed, commit 7df30fe), NOT on `main`, so the live app isn't calling RPCs that don't exist yet. The skill zip was rebuilt. Merge to `main` only after the migration is applied.

**Next steps:**
1. Recreate the skill zip if it's missing. Then run `npx tsc --noEmit -p .`, `npm test`, `npm run test:e2e` and `npm run build`.
2. Announce, then apply the migration as `feedback_approve_process`, and rename the file to the recorded version.
3. Commit (with the attribution lines) and push. Pull/rebase first: the revision worker also commits to `main`.
4. Verify live: `/api/health`, then a signed-in check of the asset page if possible.
5. Tell Shane how to redo Clay Output 9x16: approve the burst-pipe note (and/or the fuse note), then press Process approved feedback. Optionally fire the worker now: `fire_trigger trig_019BM1d6nJaLeUDN6YTpjoRQ`.
6. Optionally clean up the duplicate legacy comments (two identical items at 19:30 and two at 19:58 on 9x16; all are already applied, so this is history clutter only).

## Shipped earlier today (live)
- **Higgsfield in-app** (commit d484cd5), migration `20261029231913_higgsfield_jobs`:
  - Create → Higgsfield video form: Seedance 2.5, 4–12s (default 9), 720p, sound toggle, any creator can generate.
  - `/api/higgsfield/{generate,status,usage,webhook}`; the POST is never retried and is idempotent.
  - A "Rendering" version is filled in once by the server; failed or moderated renders show the reason.
  - Monthly seconds are shown; the optional cap is `HIGGSFIELD_MONTHLY_SECONDS`.
  - No real in-app render has run yet.
- Owner permissions, personal inboxes plus an admin view, the Claude API (`/api/v1`) with personal tokens, the `yoke-ad-maker` skill, revert, and the Changes log.
- Slack: shares post the real video to #yoke-creative-review, thread replies become feedback pinned to a version, edits and deletes keep history.
- Voice feedback (record → transcript fills the box).
- Reject ad (archives it and cancels queued jobs).
- Scheduled tasks: revision worker `trig_019BM1d6nJaLeUDN6YTpjoRQ` (hourly at :32; can be fired on demand); app-feedback relay `trig_01SBvqqY5ZfDrbVti4oUDbvZ` (hourly at :13).
- Clay ad engine is in `creative/clay/`.

## Open / deferred
- Henry asked for studio comments to post to the Slack channel ("like google doc"). Waiting on Shane's decision.
- Duplicate Vercel project "advertisement_loop": Shane should disconnect its Git.
- B2 M1 revision job is `needs_input`: its source is a Claude Design Motion film, which the worker can't recut.
- Clay Output 9x16 job was `working` at the last check.
- Not yet verified with Shane's own login: the new screens, and a live two-person run with Teng and Henry.
