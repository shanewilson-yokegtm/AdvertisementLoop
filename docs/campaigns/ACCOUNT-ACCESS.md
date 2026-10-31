# Campaign operator: account access and gated changes (discovered Oct 30, 2026)

Read-only discovery from a Claude session. Nothing below was changed in production. Each gated change lists target, exact change, validation and rollback for Shane's approval.

## What was observed

| Area | Observed | Status |
|---|---|---|
| Production app | `advertisementloop-eight.vercel.app`, `main` = `6ab9273`. `/api/health`: Supabase, Slack, Higgsfield configured; `claude: false`. | Live |
| Hosted MCP + OAuth | `/api/mcp` returns 401 with `WWW-Authenticate` pointing at `/.well-known/oauth-protected-resource/api/mcp`, which names Supabase Auth `uevktzprbpymfcquotmb` as the authorization server. One OAuth client registered. | Endpoint live. Tool discovery after sign-in not verified (needs a person to complete OAuth in Claude). Campaign tools are not on `main`, so the hosted server does not expose them yet. |
| Supabase migrations | Production has 18 migrations through `20261030161111_claude_revisions`. No `campaign_*` tables. All functions the campaign migration depends on exist (`app_private.is_server`, `role_of`, `role_rank`, `role_at_least`). | `20261030233954_campaign_operator` unapplied; dependencies satisfied. |
| Supabase advisor | `app_private.mcp_oauth_config` has RLS disabled. `anon`/`authenticated` have no SELECT on it and it holds only the public client id. | Low practical risk; fix recommended (below). |
| Meta | Claude connector "Meta ads AI" is installed but `connect_incomplete`. No Meta tools available in the session. | Blocked: needs Shane to finish the connection. Ad account ID, Business Manager role, pixel/dataset and page identity unverified. |
| LinkedIn | No LinkedIn Ads connector installed or found in the registry. | Blocked: needs a decision on access path (LinkedIn Marketing API app with server-held token, or browser-based execution). |
| Waitlist outcome source | Limited search only: HubSpot portal "Yoke" (22312186, America/Vancouver, USD) is connected and has UTM properties (`utm_campaign___original/latest`, `hs_analytics_source`). A keyword search of contact properties did not surface a GTME waitlist property; forms, lists, other object types and other systems were not checked. The Webflow connector exposes only a "HeyStack" site. This does not show the source is absent. | Unidentified: Shane needs to name the authoritative waitlist record (form/property/table/system). |
| Skill package | `npm run package:campaign-skill` reproduces the committed `skills/campaign-operator.zip` content exactly. | Ready. Installing it in the team Claude environment is Shane's action. |

## Gated changes (prepared, not applied)

### 1. Apply the campaign migrations
- **Target:** Supabase `uevktzprbpymfcquotmb`.
- **Change:** two `apply_migration` calls, in order: `supabase/migrations/20261030233954_campaign_operator.sql` (name `campaign_operator`), then `supabase/migrations/20261031001000_campaign_execution_ledger.sql` (name `campaign_execution_ledger`). Rename each local file to the version Supabase records. The ledger adds tables and server-only functions only; nothing calls them in the deployed app.
- **Order:** apply before merging/deploying this branch to `main` (the app code expects the tables and `campaign_commit` RPC).
- **Validate:** `list_tables` shows the four `campaign_*` tables plus `campaign_execution_steps` and `campaign_execution_log`, all with RLS on; `get_advisors` (security, performance) adds no new findings; `has_table_privilege('anon','public.campaign_records','SELECT')` is false; `has_function_privilege('authenticated', …)` is false for `campaign_commit`, `campaign_step_claim`, `campaign_step_complete` and `campaign_step_reconcile`.
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
