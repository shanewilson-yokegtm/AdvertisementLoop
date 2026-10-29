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
- **Execute changes** in the app queues the revision worker (scheduled Claude session, hourly, playbook in `creative/REVISIONS.md`). In Claude, the person approves and the result is saved directly.

## Claude skill and API

- Skill package: `skills/yoke-ad-maker/` (zip: `skills/yoke-ad-maker.zip`). Helper: `scripts/adstudio.py`.
- API: `/api/v1/*`, authenticated with a personal token from **Connect Claude** (stored hashed, revocable). Needs `SUPABASE_SERVICE_ROLE_KEY` in Vercel; all writes still go through owner/admin checks as the token's member.
- Tests: `npm test` (database rules, API, Slack, UI) and `npm run test:e2e` (skill helper -> API -> database with real file bytes).

## Slack review threads

1. Create a Slack app for the Yoke workspace. Bot scopes: `chat:write`, `im:write`, `files:write`, `files:read`, `channels:history`, `groups:history`, `reactions:read`, `users:read`, `users:read.email`, `channels:read`, `groups:read`. (`files:*` lets videos post as playable files.)
2. Event Subscriptions: request URL `https://<app>/api/slack/events`; bot events `message.channels`, `message.groups`, `reaction_added`, `reaction_removed`.
3. Vercel env: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `APP_URL` (the public app URL).
4. Invite the app to a test channel. Owners pick the channel when sharing; replies in that thread become comments on the shared version.

## Optional features (off until approved)

- **Claude in Create an ad**: needs `ANTHROPIC_API_KEY` (Anthropic API, billed separately). Without it, conversations and type choices are saved but Claude doesn't reply.
- **Share to Slack**: needs a Yoke Slack app with `chat:write` and its bot token in `SLACK_BOT_TOKEN`; invite the bot to the review channel. Without it, Share copies a ready-to-paste message.
- **Higgsfield video**: not connected. Choosing it saves the idea as a pending Library item and says why.

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
