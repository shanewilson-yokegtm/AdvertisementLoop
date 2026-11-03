# Meta account performance

`/performance` adds account-wide reporting to Ad Studio. `/api/performance` is a session-authenticated, member-only GET endpoint. No database migrations, paid model calls, ad writes, contact exports or launch adapters are involved.

## Connection

Set `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_API_VERSION` and optionally `META_ACCOUNT_TIMEZONE` in the intended deployment's server secret store. Local development uses an ignored `.env.local`. Never prefix the token with `NEXT_PUBLIC_`, commit it, log it, or put it in a browser URL. Use a dedicated company-owned Meta app with `ads_read` access to the intended account. `ads_management` is unnecessary for this dashboard.

The account is fixed by the server. Browser requests can select dates and a numeric campaign ID, never another account, a credential or a provider URL. Authorization checks the current Ad Studio membership on every request; all existing member roles can read company performance. Responses are private and not cached. There is no scheduled polling or paid generation. Refresh is explicit.

Credential failures show a reconnect message; rate limits show a wait-and-refresh message. Rotate through the dedicated Meta app and replace the server secret, then redeploy. Do not assume a generated user token is permanent. API versions are pinned; check Meta's supported version schedule before upgrading. No secrets are required in CI.

## Measurement contract

- Default: last 30 complete account-local calendar days. Presets include today, 7/30/90 complete days and month to date through yesterday. On the first day of the month, month to date includes that partial day. Custom ranges are inclusive, at most 93 days, with no future dates. Previous period is the same number of immediately preceding days.
- Reporting uses `action_report_time=impression` and each ad set's unified attribution setting. Different ad sets can have different attribution windows. Event selectors show Meta-attributed view-content, lead, start-trial or purchase events; these are not verified CRM outcomes, unique signups or waitlist members. Prefer the exact website event alias over overlapping aggregates; never add aliases together.
- Spend, clicks, impressions and attributed events can be added across ads. Reach is never added across ads/days: account and campaign reach come from provider aggregates at that exact grain. Frequency is aggregate impressions / aggregate reach. Missing reach and zero-denominator rates show a dash. Percentage change with a zero baseline is unavailable.
- Full-range ad, daily ad, account and campaign insights are required and fully paginated. Failed, repeating or oversized pagination rejects the report rather than presenting partial totals. Empty successful daily results can produce zero days; failed daily results cannot. Comparison/metadata/platform failures are explicit warnings. Provider errors cannot echo credentials into API responses.
- Publisher platforms are Meta delivery surfaces, not inferred channel labels in audience names. LinkedIn is unconnected.
- IDs preserve separate campaigns, ad sets and creatives. Gallery inventory includes creatives without delivery in the period. Shared creative IDs aggregate their ads; mixed current statuses are labelled. Historical ads missing from current inventory retain their metrics with previews unavailable.
- Concept groups are provisional: the second pipe-separated segment of ad names. Unclassified ads remain visible. There is no canonical Library/version mapping yet; creative IDs are Meta identities, not Yoke Library version numbers.
- Metrics cover selected dates; status, budget, targeting, placements, attribution configuration, copy and creative are current observations. They do not establish what settings were active on a past day or who changed them. The settings panel states this distinction. Planned-versus-actual reconciliation and change-history attribution remain separate follow-up work.
- Gallery images use HTTPS Meta CDN URLs and fail visibly when unavailable/expired. Placement-adapted creative hashes are resolved through the same account's read-only image library, in bounded batches, to avoid enlarging Meta's tiny thumbnails. Details show each returned image asset and its dimensions; the gallery image is a representative asset, not a rendered placement. Dynamic copy/destinations come from the asset feed when static fields are absent. An image lookup failure keeps reporting available with an explicit thumbnail warning. Video cards identify thumbnails; they do not claim playable video. Destination links reject non-HTTP(S) schemes. CSV exports contain the filtered table's values and dates/timezone/freshness, escape formulas, and include no credentials.

## Verification and release

Run `npm run test:performance`, `npm run test:campaigns`, `npm test`, `npm run typecheck`, and `npm run build`. Reporting tests cover overlapping action aliases, correct reach grain, date boundaries, safe pagination, errors, fixed account selection, membership gates, inventory grouping and settings UI. Live verification requires separately authorized credentials and does not run in CI.

Before release, compare an identical account/date/campaign report against Ads Manager using the same attribution basis. Check signed-in account totals, date changes, campaign filter, creative images, settings, CSV, and signed-out API denial. Do not use fixture data as a production fallback. The dashboard does not enable launch or modification; those require separately reviewed adapters and authorization.

Rollback: revert the dashboard commit/release. Existing creative and campaign workflows do not depend on this endpoint. Remove or revoke the reporting credential only if intentionally disconnecting reporting.
