# One-page memo and structured plan

The human-facing memo is generated from the structured plan. Keep prose concise enough to review on one page; detailed platform choices live beneath it. The complete schema is `src/lib/campaigns/contracts.ts`; `tests/campaigns/brief.fixture.json` is an explicitly illustrative local-test example, not an approved Yoke plan.

Top-level fields: title, purpose, hypothesis, offer, qualification, primaryOutcome (snake_case ID), optional numeric target (null if not agreed), successRule, currency (ISO code), timezone (IANA), startsAt, spendEndsAt, analyzeAfter (ISO timestamps with offsets), totalCeiling, channels, experiments, heldConstant and limitations.

For each channel (Meta or LinkedIn): accountId, identityId, objective, conversionEvent, attribution, audience, placements, budget, destination and creatives.

Audience: stable ID, human name, version, business definition, countries, include, exclude, expansion, sourceListRef and separate estimatedSize/matchedSize/checkedAt. Null means not measured, not zero. Actual platform criteria must be documented concretely in include/exclude; a persona label alone is insufficient.

Budget: amount, daily/lifetime type, channel ceiling and bid strategy. Channel ceilings cannot exceed the total ceiling. A ceiling in a memo is a limit on authorized execution, not a verified native platform hard cap; the live adapter must implement and verify the agreed controls before activation.

Creative: conceptId, conceptName, exact assetId/versionId, primaryText, headline, CTA, actual width/height, placements and adaptationNotes. All selected placements must exist in the channel plan. Verify the actual platform’s eligibility and previews when connected; a width/height record alone does not prove placement readiness.

Experiments: `{rule, change, rationale}`. Name the affected playbook rule and the deliberate departure. State what is held constant. These are human-declared experimental choices, not generated recommendations.

Do not inherit Rumi account IDs, financial-category rules, offers, thresholds or budget policies. The initial GTME plan and any agency weighting remain campaign decisions to confirm.
