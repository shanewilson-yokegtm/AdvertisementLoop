# Campaign operator: account access and gated changes (discovered Oct 30, 2026; released Nov 1, 2026)

## Release record (Nov 1, 2026, approved by Shane)

| Step | Outcome |
|---|---|
| Pre-checks | PR #3 head `89e7ded`, base `6ab9273`; local SQL byte-identical to that head; production had 18 migrations, no `campaign_*` objects; all dependencies present. |
| `apply_migration campaign_operator` | Success. Recorded version **`20261101152428`**. |
| `apply_migration campaign_execution_ledger` | Success. Recorded version **`20261101152517`**. |
| Schema validation | Six tables (`campaign_records`, `campaign_events`, `campaign_observations`, `campaign_metric_batches`, `campaign_execution_steps`, `campaign_execution_log`): RLS on, 2 policies each; `anon` no access; `authenticated` SELECT only; `service_role` writes. `campaign_commit`, `campaign_step_claim/complete/evidence/reconcile` and `app_private.campaign_launch_current` execute only as `service_role`. Triggers: `campaign_execution_fence` on records; `campaign_history_immutable` on events, observations, metric batches, log, steps. |
| Behaviour check (rolled back) | `authenticated` denied `campaign_commit`; fence refused a launch change with an unknown step; step delete refused. Tables empty afterwards. |
| Security advisor | No findings on campaign objects. Existing warnings unchanged (14 pre-existing SECURITY DEFINER RPCs callable by `authenticated`; leaked-password protection off). |
| Merge | PR #3 marked ready and merged with expected head `89e7ded` as merge commit **`fb8809a`** (history preserved). |
| Deploy | Vercel commit statuses success for `fb8809a`: project `advertisementloop` deployment `DmQCnYkF91r14xbuUmSnH1KMjJYe` (https://vercel.com/yoke-gtm/advertisementloop/DmQCnYkF91r14xbuUmSnH1KMjJYe), which serves production `https://advertisementloop-eight.vercel.app` (live bundle contains the new Campaigns nav link); project `advertisement_loop` deployment `EJwUp9sPcN7r4NgeXNKHkSQbSqe3`. |
| Unauthenticated smoke | `/campaigns` → 307 to `/login?next=%2Fcampaigns`; `/api/campaigns/playbook`, `/api/v1/campaigns/playbook`, `/api/mcp` → 401; OAuth resource metadata 200; `/api/health` 200. |
| Authenticated smoke | **Passed (read-only), verified by the operator** in an existing signed-in Chrome profile (Shane Wilson): production `/campaigns` shows the Campaigns heading, New campaign input, no campaigns yet, and Meta/LinkedIn awaiting firm connections; `/connect` shows the correct MCP URL and client with "Not connected yet". Screenshot saved by the operator. Claude's built-in browser is a separate unsigned session; no sign-in email, token, or cookie import was used. |
| MCP end-to-end | **Pending.** Tool discovery of the nine `campaign_*` tools needs a person to complete the Yoke connector OAuth sign-in in Claude. |
| Not changed | Optional `app_private.mcp_oauth_config` RLS fix (change 2) not applied — outside this approval. |

Local migration files were renamed to the recorded versions in a separate metadata-only change; no SQL was replayed and Supabase migration history was not edited.


Read-only discovery from a Claude session. Nothing below was changed in production. Each gated change lists target, exact change, validation and rollback for Shane's approval.

## What was observed

| Area | Observed | Status |
|---|---|---|
| Production app | `advertisementloop-eight.vercel.app`, `main` = `6ab9273`. `/api/health`: Supabase, Slack, Higgsfield configured; `claude: false`. | Live |
| Hosted MCP + OAuth | `/api/mcp` returns 401 with `WWW-Authenticate` pointing at `/.well-known/oauth-protected-resource/api/mcp`, which names Supabase Auth `uevktzprbpymfcquotmb` as the authorization server. One OAuth client registered. | Endpoint live. Tool discovery after sign-in not verified (needs a person to complete OAuth in Claude). Campaign tools are not on `main`, so the hosted server does not expose them yet. |
| Supabase migrations | Oct 30: production had 18 migrations through `20261030161111_claude_revisions`; no `campaign_*` tables; dependencies present. | Superseded: both campaign migrations applied Nov 1 (release record above). |
| Supabase advisor | `app_private.mcp_oauth_config` has RLS disabled. `anon`/`authenticated` have no SELECT on it and it holds only the public client id. | Low practical risk; fix recommended (below). |
| Meta | Claude connector "Meta ads AI" is installed but `connect_incomplete`. No Meta tools available in the session. | Blocked: needs Shane to finish the connection. Ad account ID, Business Manager role, pixel/dataset and page identity unverified. |
| LinkedIn | No LinkedIn Ads connector installed or found in the registry. | Blocked: needs a decision on access path (LinkedIn Marketing API app with server-held token, or browser-based execution). |
| Waitlist outcome source | Limited search only: HubSpot portal "Yoke" (22312186, America/Vancouver, USD) is connected and has UTM properties (`utm_campaign___original/latest`, `hs_analytics_source`). A keyword search of contact properties did not surface a GTME waitlist property; forms, lists, other object types and other systems were not checked. The Webflow connector exposes only a "HeyStack" site. This does not show the source is absent. | Unidentified: Shane needs to name the authoritative waitlist record (form/property/table/system). |
| Skill package | `npm run package:campaign-skill` reproduces the committed `skills/campaign-operator.zip` content exactly. `campaign-operator` v1 was installed and enabled via Claude Customize in Shane's personal account (Oct 30). | Personal install only. Not published to the org; teammates do not have it. Its campaign tools work only after the code is deployed and the connector exposes them. |

## Gated changes (prepared Oct 30; 1 and 3 done Nov 1, 2 not applied)

### 1. Apply the campaign migrations
- **Target:** Supabase `uevktzprbpymfcquotmb`.
- **Done Nov 1:** recorded as `20261101152428_campaign_operator` and `20261101152517_campaign_execution_ledger` (local files now use these names; originally `20261030233954_…` and `20261031001000_…`).
- **Change:** two `apply_migration` calls, in order: `campaign_operator`, then `campaign_execution_ledger`. Rename each local file to the version Supabase records. The ledger adds tables and server-only functions only; nothing calls them in the deployed app.
- **Order:** apply before merging/deploying this branch to `main` (the app code expects the tables and `campaign_commit` RPC).
- **Validate:** `list_tables` shows the four `campaign_*` tables plus `campaign_execution_steps` and `campaign_execution_log`, all with RLS on; `get_advisors` (security, performance) adds no new findings; `has_table_privilege('anon','public.campaign_records','SELECT')` is false; `has_function_privilege('authenticated', …)` is false for `campaign_commit`, `campaign_step_claim`, `campaign_step_complete`, `campaign_step_evidence` and `campaign_step_reconcile`; trigger `campaign_execution_fence` exists on `campaign_records`.
- **Rollback:** prefer a forward fix. While the new tables are still empty (`select count(*)` on each is 0), a reviewed follow-up migration can drop the new functions and tables (ledger objects first, then `campaign_*`). Once any campaign, event, import or ledger row exists, do not drop: those rows are the audit trail. Instead revert the app code (change 3) and leave the schema in place, or export the rows before any reviewed removal. Do not edit Supabase's recorded migration history by hand.

### 2. Enable RLS on `app_private.mcp_oauth_config`
- **Important:** the access-token hook in `20261030160941_mcp_oauth_guard.sql` reads this table as `supabase_auth_admin` (granted SELECT). Enabling RLS without a policy would block that read and break connector sign-in. Apply both statements together:
  ```sql
  alter table app_private.mcp_oauth_config enable row level security;
  create policy auth_hook_read on app_private.mcp_oauth_config for select to supabase_auth_admin using (true);
  ```
- **Validate:** connector sign-in still succeeds; advisor clears; `anon`/`authenticated` still have no SELECT.
- **Rollback:** `drop policy auth_hook_read on app_private.mcp_oauth_config; alter table app_private.mcp_oauth_config disable row level security;`

### 3. Merge and deploy
- Merge PR #3 to `main` only after change 1. `main` auto-deploys to Vercel.
- **Validate:** signed-in `/campaigns` loads; in Claude, the Yoke connector lists the nine `campaign_*` tools; `campaign_playbook` reports Meta/LinkedIn as not connected.
- **Rollback:** revert the merge commit on `main` (campaign tables can stay; they are unused without the app code).

### 4. Firm account connections (Shane)
- Finish the "Meta ads AI" connector, or decide on a server-held Meta System User token in Vercel secrets. Then read-only: ad account ID, currency/timezone, business role, page, pixel/dataset and waitlist event eligibility.
- Choose the LinkedIn path and grant read-only Campaign Manager access first.
- Name the authoritative waitlist outcome source.
- The durable step ledger and executor rehearsal are on this branch (see `EXECUTION-LEDGER.md`). Live adapters stay unregistered until a real adapter is implemented against them, reviewed and tested against paused builds in the firm accounts.
