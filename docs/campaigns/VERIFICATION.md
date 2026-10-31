# Local verification — October 30, 2026

The user story is: Claude planning → shared memo → approval and explicit launch authorization → consistent execution records → audit/performance → dated closeout.

Verified against remote main `6ab927309244a018e2cdc61a8fd5771e5eda7ceb`:

| Boundary | Evidence |
|---|---|
| Campaign contracts/workflow/reporting | `npm run test:campaigns`: schema errors, exact-plan approvals, expired authorization, disconnected launch, corrections, cross-channel attribution and missing/conflicting outcomes |
| Shared API → database → response | Real PGlite with all repository migrations; creator collaboration, stale revisions, request replay, simultaneous writers, exact approved assets, import provenance and captured audit plans |
| Permissions | Viewer/anonymous writes denied; OAuth tokens cannot read tables directly; service-only commit RPC; immutable history |
| Existing product and OAuth regression | `npm test`: 66 schema + 115 ownership + 37 API + 41 Slack + 78 Higgsfield + 76 MCP + 38 UI checks passed (451 total) |
| Screen interactions | New campaign UI test covers memo approval target, viewer/closed gates, filters, unavailable performance and disconnected execution |
| Production compilation | `npm run build` passed, including `/campaigns`, browser API and the existing OAuth MCP route |
| Types | `npm run typecheck` passed |
| Skill package | `quick_validate.py` passed; `npm run package:campaign-skill` produces a ZIP containing only maintained skill Markdown |
| Visual review | Locally rendered CampaignView fixture inspected in Chrome; actual hosted authentication/data are not represented by that fixture |

No production database changes, firm account calls, media generation, ad spend or scheduler activation were used to verify this work. Hosted OAuth discovery, native platform previews, actual delivery, platform history coverage and scheduled review remain handoff checks. Run target-database advisors when reviewing the migration before applying it.

GitHub publishing initially failed with 403: local Git is authenticated as `shanewilson9898-98`, without write access to `shanewilson-yokegtm/AdvertisementLoop`. The connector also reports read-only access. Local commits and a handoff bundle preserve the work until Yoke publishing access is connected.
