# Yoke Ad Studio (AdvertisementLoop)

A simple ad builder for the Yoke team. One loop, nothing else:

**idea → branded static or video ad → shared Library → share for feedback → next version**

Two screens: **Library** and **Create an ad**. A corner button sends bugs and suggestions.

## Stack

| Piece | Where | Notes |
| --- | --- | --- |
| App | Next.js 16 (this repo) on Vercel | `src/app` |
| Database, sign-in, files | Supabase project `YokeGTM_AdvertisementLoop` (org YokeGTM_Marketing+Sales, us-east-2) | Migrations in `supabase/migrations` |
| Media | Private Supabase Storage bucket `ad-assets` | Served through short-lived signed URLs |

Nothing here uses Rumi or other Yoke production systems.

## Who can do what (enforced in the database, not just the UI)

- Sign-in is an email magic link. Only `@yokegtm.com` addresses (or emails an admin adds to `role_grants`) become members; anyone else sees nothing.
- New Yoke users join as **creator**: view, create, upload, comment, share, iterate.
- **approver / admin** can also approve or request changes. Shane is admin.
- Every "who did this" column is set from the signed-in user. Version numbers are assigned by the database under a lock, so two people iterating at once get v3 and v4. Versions, chat messages, shares and review history can't be edited or deleted.

## Vercel setup

1. Vercel → Add New → Project → import `shanewilson-yokegtm/AdvertisementLoop` (framework: Next.js). Use the Yoke Vercel team.
2. Project → Settings → Environment Variables (all environments):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://uevktzprbpymfcquotmb.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = Supabase → Project Settings → API Keys → publishable / anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = same page, secret / service_role key (server only; never paste it anywhere else)
   - `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` = `yokegtm.com`
   - Optional, each switches on one feature once approved: `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`), `SLACK_BOT_TOKEN`
3. Deploy. Note the production URL.
4. Supabase → Authentication → URL Configuration: **Site URL** = the Vercel URL; **Redirect URLs** add `https://<vercel-url>/auth/callback`.
5. Supabase → Authentication → Emails: the built-in mailer is rate-limited (a few emails per hour). Fine for 3 people; add custom SMTP before inviting more.

## Ownership, feedback and processing

- Every ad has an owner (its creator). Only the owner or an admin can add versions, revert, reject, share to Slack, resolve feedback, or read its review drafts and working chats. Everyone can read and comment. Approval stays with approvers. All of this is enforced in the database (`supabase/migrations/*ownership_processing*`).
- **Feedback to process**: each owner's pending feedback (server-computed `feedback_inbox`), with an admin view of everyone's.
- **Process feedback** opens one shared review record (`processing`), used by the app and by each person's Claude. Nothing changes until someone picks decisions and executes. Saves are checked against the current version; conflicts are surfaced, never overwritten.
- **Regenerate ad** in the app freezes the approved items (text, author, version, time) and queues the revision worker (scheduled Claude session, hourly, playbook in `creative/REVISIONS.md`); Slack edits after that don't change the job. For a finished Higgsfield video the button is **Regenerate in Higgsfield**: one paid, confirmed render in the app server (see below), not the worker.

## Claude skill and API

- Installable skill: `skills/ad-builder.zip` contains the complete workflow, helper and brand resources; no second skill is required. `skills/yoke-ad-maker/` is the maintained source and compatibility package. Rebuild both skills and the single-entry plugin with `python3 scripts/package-skills.py`. Replacing code in GitHub does not update an already-installed Claude skill: use its **Replace** action and verify the installed contents target this live app, not the retired Claude artifact.
- **Revisions in your own Claude:** the hourly worker can only rebuild repo-engine ads (`source.engine` = `creative/...`).
  For everything else the app shows **Continue in Claude**, and the connector's `start_revision` claims the run (atomic
  against the worker and other people; stale claims only by explicit take-over), returns only the frozen approved items
  and the exact parent, then `save_version` (with `processing_id`) and `complete_revision` / `fail_revision` close it
  through the same processing rules. Migration `20261030161111_claude_revisions`.
- **Claude connector (recommended, built but off until approved):** remote MCP at `/api/mcp`, signed in per person through Supabase Auth's OAuth 2.1 server with explicit consent at `/oauth/consent`. Tools call the same API rules as the app, as that member. See *Claude connector setup* below.
- API: `/api/v1/*`, authenticated with a personal token from **Connect Claude › Advanced** (stored hashed, revocable). For Claude Code and scripts that keep secrets in their own environment. Needs `SUPABASE_SERVICE_ROLE_KEY` in Vercel; all writes still go through owner/admin checks as the token's member.
- Tests: `npm test` (database rules, API, Slack, UI) and `npm run test:e2e` (skill helper -> API -> database with real file bytes).

## Slack review threads

1. Create a Slack app for the Yoke workspace. Bot scopes: `chat:write`, `im:write`, `files:write`, `files:read`, `channels:history`, `groups:history`, `reactions:read`, `users:read`, `users:read.email`, `channels:read`, `groups:read`. (`files:*` lets videos post as playable files.)
2. Event Subscriptions: request URL `https://<app>/api/slack/events`; bot events `message.channels`, `message.groups`, `reaction_added`, `reaction_removed`.
3. Vercel env: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `APP_URL` (the public app URL).
4. Invite the app to a test channel. Owners pick the channel when sharing; replies in that thread become comments on the shared version.

## Optional features (off until approved)

- **Claude in Create an ad**: needs `ANTHROPIC_API_KEY` (Anthropic API, billed separately). Without it, conversations and type choices are saved but Claude doesn't reply.
- **Share to Slack**: needs a Yoke Slack app with `chat:write` and its bot token in `SLACK_BOT_TOKEN`; invite the bot to the review channel. Without it, Share copies a ready-to-paste message.
- **Higgsfield video**: on when `HF_CREDENTIALS` is set in Vercel (see below); otherwise choosing it saves the idea as a pending Library item and says why.

## Develop

```bash
npm install
npm test            # schema + permission tests (Postgres in WASM)
npm run build
```

Schema changes go in a new file in `supabase/migrations/` and are applied to the Supabase project.

## Review and conversation reliability

Review links include `?v=<version-id>`. An open review stays on its selected version when a teammate uploads another one. Choosing a different version clears unfinished review/comment text. Approval requires a ready media file and no failed checks, enforced by the database as well as the screen.

Conversations stop accepting new messages at 60 stored messages and offer **Start a new chat**. The new chat keeps the linked Library asset, whose latest design and open feedback remain available; the old conversation is retained. Failed requests offer a retry using the same message ID. Saved assistant replies are returned again when a response was lost in transit.

Private media access renews automatically in open tabs and when returning to a tab. Renewal preserves the video playhead and playback intent.

Apply `20261029154845_collaborator_review_reliability.sql` before deploying this update. It adds reply deduplication and approval readiness checks without changing member roles or the manual app-feedback review process. `npm test` covers permissions, review version selection, recovery, conversation rollover, and media renewal. Claude generation and Higgsfield still require their separately configured connections.

## Higgsfield video (Seedance 2.5)

Create an ad → **Higgsfield video**. Any creator can generate. Settings are fixed by Shane: 4–12 s (default 9), always
720p (the highest Seedance 2.5 offers), sound on/off toggle, format vertical 9:16 / feed 3:4 / square 1:1 / landscape 16:9.

- `HF_CREDENTIALS` (`key-id:key-secret`) lives only in Vercel. The browser never sees it.
- One press = one request: the POST to Higgsfield is never retried, and a repeated press reuses the same idempotency key.
- A "Rendering in Higgsfield" version appears at once. Higgsfield calls `/api/higgsfield/webhook?job=…` when done (the
  body is ignored; the server re-checks Higgsfield itself), and the ad page also checks every 10 s. The MP4 is copied
  into Supabase storage and filled into that same version exactly once. Moderated, failed or out-of-credit requests
  show "Render failed" with the reason; nothing is called a success unless a real MP4 arrived.
- Usage (seconds this month) shows under the form. Optional cap: set `HIGGSFIELD_MONTHLY_SECONDS` in Vercel.
- Only a 4xx is a refusal. A timeout, an HTTP 5xx, or a 2xx with no request id is an *unknown outcome*: the job and its
  usage stay reserved, the version stays Rendering, and nothing is retried. Check the Higgsfield dashboard first.
- A new version of an existing video ad keeps that ad's frame; asking for another format is refused. Labels show the
  real media frame: the feed preset renders 3:4, landscape renders 16:9.
- **Regenerate in Higgsfield** (owner/admin): freezes the approved feedback, renders once on the newest finished
  version with its length/frame/sound, and marks the feedback applied only after the MP4 and version are saved.
  A refused render fails the run and leaves the feedback approved; a repeated press never pays twice: an atomic claim
  (`higgsfield_revision_claim`) lets exactly one caller create the version and submit; a second press says
  "already starting" and never closes the run. A claim is retaken only if stale (2 min) with no job.

## Claude connector setup (needs Shane's approval; nothing below is enabled by the code)

The connector is per person: each member signs in with their own Yoke account and approves it once. No shared token.

1. Apply migrations `20261030160941_mcp_oauth_guard`, `20261030161044_higgsfield_revisions` and `20261030161111_claude_revisions` (Supabase approval card).
   The guard makes OAuth connector tokens useless against the Data API, Storage and Realtime (PostgREST pre-request
   check + restrictive RLS on every table), so the connector can only act through `/api/mcp`.
2. Supabase › Authentication › OAuth Server: enable it; **Authorization Path** `/oauth/consent` (Site URL must be the app
   URL); leave **Dynamic client registration off**.
3. Register one OAuth client: name `Claude`, type **public** (no secret, PKCE), redirect URI
   `https://claude.ai/api/mcp/auth_callback`. Copy its client id.
4. SQL: `update app_private.mcp_oauth_config set resource = '<APP_URL>/api/mcp', client_ids = '{<client id>}';`
5. Supabase › Authentication › Hooks › Custom Access Token: `public.mcp_access_token_hook`. It changes `aud` only for
   OAuth tokens (registered client → the MCP URL; anything else → an audience nothing accepts). Browser sessions are
   unchanged.
6. Vercel env (Production): `MCP_CONNECTOR_ENABLED=true`, `MCP_OAUTH_CLIENT_IDS=<client id>`,
   `NEXT_PUBLIC_MCP_OAUTH_CLIENT_IDS=<client id>`, and `APP_URL` (already set). Redeploy. Leave `MCP_ALLOWED_ORIGINS`
   unset unless a browser-based MCP client must call the endpoint; it takes exact `https://host` origins only.
7. Claude › Organization settings › Connectors › Add › Custom › Web: URL `<APP_URL>/api/mcp`, **Use your own OAuth
   client**, client id from step 3, secret blank. Members then press **Connect** under Customize › Connectors.
   Suggested: set `higgsfield_generate`, `higgsfield_regenerate` and `post_to_slack` to **Ask** in tool permissions.

Checks the endpoint makes on every call: ES256/RS256 signature from the project JWKS, issuer, audience = the MCP URL,
registered client id, `role=authenticated`, the Supabase session still exists (Disconnect is immediate), and the
member's current role. Discovery: `/.well-known/oauth-protected-resource/api/mcp` → Supabase Auth.
Before any of that, a request carrying an `Origin` header must match the allowlist exactly (the app's own origin, plus
`MCP_ALLOWED_ORIGINS`), or it gets 403 (MCP DNS-rebinding rule). Requests without `Origin` (Claude's servers) go on to
the token checks. No CORS headers are sent.
