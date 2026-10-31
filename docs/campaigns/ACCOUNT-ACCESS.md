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
| Waitlist outcome source | HubSpot portal "Yoke" (22312186, America/Vancouver, USD) is connected and has UTM properties (`utm_campaign___original/latest`, `hs_analytics_source`). No GTME waitlist property or form found. The only Webflow site visible is "HeyStack", not the Yoke site. | Unidentified: Shane needs to name the authoritative waitlist record (form/property/table). |
| Skill package | `npm run package:campaign-skill` reproduces the committed `skills/campaign-operator.zip` content exactly. | Ready. Installing it in the team Claude environment is Shane's action. |

## Gated changes (prepared, not applied)

### 1. Apply the campaign migration
- **Target:** Supabase `uevktzprbpymfcquotmb`.
- **Change:** `apply_migration` with the contents of `supabase/migrations/20261030233954_campaign_operator.sql`, name `campaign_operator`. Then rename the local file to the version Supabase records.
- **Order:** apply before merging/deploying this branch to `main` (the app code expects the tables and `campaign_commit` RPC).
- **Validate:** `list_tables` shows the four `campaign_*` tables with RLS on; `get_advisors` (security, performance) adds no new findings; `select has_table_privilege('anon','public.campaign_records','SELECT')` is false; `has_function_privilege('authenticated','public.campaign_commit(text,integer,uuid,text,text,text,jsonb,text,jsonb,jsonb,jsonb)','EXECUTE')` is false.
- **Rollback (tables are empty until first use):**
  ```sql
  drop function if exists public.campaign_commit(text,integer,uuid,text,text,text,jsonb,text,jsonb,jsonb,jsonb);
  drop table if exists public.campaign_metric_batches, public.campaign_observations, public.campaign_events, public.campaign_records cascade;
  drop function if exists app_private.campaign_history_immutable();
  delete from supabase_migrations.schema_migrations where name = 'campaign_operator';
  ```

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
- Live adapters stay unregistered until handoff step 7 (durable step ledger, paused build, readback) is built and reviewed.
