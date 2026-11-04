# Campaign hosting 1.0.2

The review exports retain the source memo, audience qualification and explicit campaign ID. Platform-optimized arm weights describe planning intent, not delivered spend or exposure. Prefer Prepare-tab downloads so chat attachments do not become stale after revisions.

This release adds a preparation workflow to Ad Studio: memo → resolved decisions → exact Library selections → deterministic review packet. It does not depend on AdBuilder, Meta execution, new credentials, paid rendering or a database migration. The existing campaign JSON/event store holds `state.preparation`; old campaign and launch records remain compatible.

## Standard operations in code

- `hosting-contracts.ts`: incomplete preparation briefs, typed experiment arms and ad assignments, integer-cent budgets, explicit offset dates, exact rendition references.
- `hosting.ts`: stable deployment joins, readable campaign/ad/asset labels, URL tracking, identity continuity, readiness issues, manifest hashing, CSV and Markdown. No model, clock, network or random IDs in the compiler.
- `campaign-hosting.ts`: bounded, batched Library reads and latest-version asset search; compilation as the signed-in member. Library checks carry an observation time outside the deterministic manifest.
- `campaign-api.ts` / `campaigns/mcp.ts`: the existing authenticated API and MCP expose the same save/compile/search operations. Saves use revision checks, atomic event history and identical-command replay.
- `HostingPanel.tsx`: Campaigns → Prepare, memo editing, current Library readiness, generated labels, review links, downloads and copyable handoff. Failed or conflicting edits retain the local memo.

The assistant interprets semantic input; code performs standard operations. Browser memo edits mark the interpretation stale. The assistant reconciles saved decisions before compiling a usable packet.

## Naming and analysis

Example campaign label: `YOKE__meta__yoke__upkeep_vs_cost__<record-token>`.

Example asset name: `YOKE__yoke__workflow_upkeep__original__static__feed45__<version-token>.png`.

File extensions follow the actual stored MIME type. No automatic conversion or renaming of media bytes occurs.

The saved campaign record ID scopes joins globally. Initiative, campaign, audience, concept and variant keys are explicit dimensions. Null initiative/campaign/channel fields can be completed later; their first deliberate values become fixed. Preserve ad identities as excluded entries instead of deleting/reusing them. A copy/media/audience/destination/experiment change gets a distinct deployment key; a title change does not. Never parse a readable label as the authoritative join.

Recommended new URLs use `utm_campaign=<campaign record ID>`, `utm_content=<deployment key>` and readable `yoke_*` dimensions, with `yoke_arm` when an ad has a known arm. A randomized page router must record its post-click arm and retain incoming tags. Other query parameters/fragments are preserved. These are recommendations for a new deployment: this release never relabels live ads or rewrites historical UTMs.

The analysis CSV has one row per ad rendition. **Do not sum ad-level delivery metrics after joining to rendition rows.** Join delivery on ad_key and deduplicate to the intended reporting grain; use concept_key to compare concepts, content_hash for the creative content, arm_key for known experiment assignment, and asset_id/version_id for exact media. File counts are not concept counts. Platform and first-party business outcomes remain distinct.

## Interfaces

| Operation | MCP | Personal/browser API suffix under campaigns |
|---|---|---|
| Conventions and incomplete template | campaign_hosting_guide | GET hosting-guide |
| Find exact Library candidates | campaign_asset_search | GET hosting-assets?q=...&format=feed45&approvedOnly=true |
| Save a preparation brief | campaign_hosting_save | POST `<id>/commands`, type save_preparation |
| Compile/recheck the current packet | campaign_prepare | GET `<id>/preparation` |

Personal clients use `/api/v1/campaigns`; the signed-in browser uses `/api/campaigns`. These are the existing identity boundaries. No shared admin header or alternate privileged path is introduced.

`campaign_prepare` returns `{manifest,csv,markdown,libraryCheckedAt}`. The hash covers the canonical manifest, excluding its own hash field. The manifest includes schema/compiler version, exact input/plan hashes, campaign ID/revision, issues, ad/media inventory, experiments and remaining launch checks. Repeating the same brief, record and Library facts returns identical manifest/CSV/Markdown. A changed Library review appropriately changes the manifest hash. Title/revision changes change the packet hash but preserve deployment joins.

Readiness means **ready for review**, never upload, attachment, approval or launch. Preparation-only issues and launch-only checks remain distinct. The hosting module cannot authorize spend. Its saved preparation is not implicitly converted into the legacy launch brief; a future adapter must explicitly bind the exact manifest to its own plan approval/readback.

## Local rehearsal and checks

```
npm run hosting:guide
node scripts/campaign-hosting.mjs compile input.json /tmp/campaign-packet
npm run package:hosting-skill
npm run test:campaigns
npm test
npm run test:performance
npm run typecheck
npm run build
```

Local compile input is `{campaign:{id,title,revision}, preparation, library:[...]}`. Library facts are rehearsal snapshots only; hosted compilation reads its own Library. Keep account evidence and tokens outside the repository. `skills/ad-hosting/scripts/hosting.py` is an optional personal HTTP transport; it calls the hosted compiler instead of duplicating logic.

The JSON Schema distributed with the skill covers structural validation. The server's Zod refinements additionally enforce cross-field sums, uniqueness, chronology, timezones and budget relationships. Tests exercise those semantic constraints.

## Org publication packet

The org admin can publish **ad-hosting 1.0.2** using `skills/ad-hosting.zip`, or the equivalent `plugins/ad-hosting-plugin.zip` if using the workspace plugin catalog. They are alternative packaging routes for the same entrypoint; do not install both under competing copies. Publish the revised campaign-operator package if that older skill is distributed, so its discovery description routes memo preparation to ad-hosting. AdBuilder is unchanged.

One consolidated admin request:

> Please publish the attached **ad-hosting 1.0.2** skill to our Claude workspace. It prepares market-test memos, selects Library versions, and generates campaign labels, tracking, CSV and handoffs through Yoke Ad Studio. Please also replace the older campaign-operator package if it is shared, so memo preparation routes to ad-hosting. Use the existing Yoke Ad Studio connector and each member's own sign-in; no new Meta/Higgsfield access or backend keys are needed for hosting. The application release must expose campaign_hosting_guide, campaign_asset_search, campaign_hosting_save and campaign_prepare before we call it operational.

After application deployment, test in a fresh personal Claude chat:

> Use /ad-hosting. Call whoami and campaign_hosting_guide. Report my identity, role and compiler version. Do not create, render, share or launch anything.

Then use a disposable draft and real approved Library versions: save an incomplete memo, resolve only its missing business decisions, compile twice, download the packet, and resume in another fresh chat using the campaign ID. Confirm title changes preserve joins, an intervening browser save causes a revision conflict, and another legitimate member can read the plan under their own identity. No second-user session is impersonated. Org-wide visibility is unverified until a second member actually sees the skill.

## Claude collaboration and rollout limits

Claude reviewed the design and actual prototype package in a dedicated chat. It locally validated the original template, helper help and missing-token behavior, and simulated the missing-tool fallback without claiming a save. Its feedback led to nullable identity fields, direct Library search, explicit arm assignments, stronger schema notes and safer structured HTTP errors. The revised skill/package still needs fresh-chat connector verification after the application is deployed. A package file or repository push alone does not prove installed runtime behavior.

No live publication, platform connection, source-recovery migration, media rebuild or company-hosting migration is included. Legacy adoption and external execution remain separate work. Supported currencies are CAD/USD/EUR/GBP; budgets are campaign-level. Add an explicit contract extension for other allocation/currency models.
