---
name: ad-hosting
description: Prepare and review Yoke market-test campaigns in the shared Ad Studio hosting tool. Use for a campaign memo, clarifying decisions, exact asset assignments, labels, tracking exports and colleague handoff. Creative production belongs to ad-builder; platform publication belongs to the connected campaign executor.
metadata:
  version: "1.0.0"
---

# Ad hosting

Package **1.0.0**. Help the person turn a market-test memo into a shared, reviewable campaign preparation packet. The hosted code computes names, joins, tracking, readiness and exports. Do not reproduce those algorithms in chat.

## Connect and resume

Find the team's Yoke Ad Studio tools, including `whoami`, `campaign_hosting_guide`, `campaign_asset_search`, `campaign_get`, `campaign_hosting_save` and `campaign_prepare`. Call `whoami` and `campaign_hosting_guide` before saving. A visible connector or installed skill alone does not establish working authentication. If tools are missing, search available tools once and report the specific missing capability; continue with a local draft, clearly unsaved. Never substitute the privileged Supabase connector or an admin key for the member's identity.

Use an existing campaign ID when provided. Otherwise use `campaign_list`, match purpose and ask only if genuinely ambiguous. Create through `campaign_create` when a new test is needed, preserving its request key after a lost response. Read the saved campaign before editing. The record and its revision carry teammate context across chats.

## Interpret the memo

Start with what the person wants to learn. Retrieve the existing plan and selected Library assets before asking questions. Explain your interpretation, offer reasoned defaults for routine choices, and ask one concise batch of consequential unanswered business decisions when possible. Preserve decisions already made; do not invent budget, destination, qualification, dates or approval. Incomplete inputs are valid: use nulls and empty selections in the guide's template.

Capture hypothesis, intended audience/qualification, offer, outcome, market, budget/currency, timing, test design, exact concepts/versions and required rendition formats. Use `campaign_asset_search` to find approved candidates by concept/name and format, and `get_ad` for their actual version history. Narrow the search when hasMore is true. Pin returned exact version IDs; never use “latest” or invent an ID. If tools are absent, ask for asset references only after disclosing that Library discovery is unavailable. If media is missing, retain that gap and prepare the rest. Do not generate or adapt media during this workflow; hand the specific asset request to ad-builder.

For a landing-page comparison, capture arms, weights, entry destination and allocation method. Distinguish ordinary platform optimization from random assignment. Missing routing evidence remains a launch check. The compiler does not implement a router.

Choose short analysis keys deliberately. Unresolved initiativeKey, campaignKey and channel stay null; they become fixed at their first deliberate selection, not when an incomplete memo is saved. Prefer existing initiative and concept keys for the same meaning. Each ad's concept/variant identity becomes fixed. Use a new ad key for a different concept or variant; preserve old entries with `disposition: excluded`. Excluding an ad here never rejects or archives its Library media. Assign ad armKey for a multi-arm creative comparison or native experiment; randomized page routing assigns the page arm after the click. Read [the contract](references/contract.md) for identity, currency and format details.

Set `decisionsCurrent: true` after reconciling the typed decisions with the current memo and the person's answers. This records interpretation, not creative approval or spending authority. Browser memo edits set it false so stale decisions are not silently reused.

## Save, compile, hand off

Call `campaign_hosting_save` with the preparation object, latest `expectedRevision`, and a fresh request key. Reuse that exact key/body only to recover the identical save after a lost response. On conflict, reload the shared record and reconcile intervening decisions; never force an overwrite. Viewer access is read-only. Hosting saves are limited to draft records.

Call `campaign_prepare`. It batches Library checks and returns a manifest, consolidated issues, CSV and Markdown. Show preparation questions first, then launch-only checks, counts and selected versions. Use its labels and destinations exactly. `libraryCheckedAt` is the current observation time; the manifest hash covers the exact compiled evidence. Recompile after a review change or before handing the packet to a publisher.

Deliver the returned manifest, analysis CSV and handoff Markdown as files using the client's normal file-writing facilities, or direct the person to the campaign's **Prepare** tab downloads. Do not fabricate hosted download URLs. Preserve `manifestHash`, `campaignId`, revision, compiler version and exact version IDs. A colleague should be able to resume using only the shared campaign ID and packet.

“Ready for review” does not mean approved, uploaded, attached, verified or live. This hosting slice cannot execute platform operations. If the person asks to publish, carry their exact intent and manifest to the connected execution workflow; do not call the legacy `attempt_launch` or improvise browser account changes. AdBuilder integration is a later consumer of this same contract.

## Fallback

The maintained [HTTP helper](scripts/hosting.py) supports capable clients with their own personal token in environment variables; run `--help`. It calls the same hosted code. It does not supply another compiler, credentials or deployment. If neither authenticated tools nor a capable personal HTTP client is available, provide the unresolved memo/brief locally and state that it has not been saved or compiled against the Library.
