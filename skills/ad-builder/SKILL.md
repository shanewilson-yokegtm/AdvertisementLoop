---
name: "ad-builder"
description: "Start a Yoke ad in Yoke Ad Studio: pick static, infographic video or Higgsfield video, share the concept, then make it (Higgsfield renders for real through Ad Studio) or hand off to the Studio. Use when someone says 'use the ad builder', 'ad builder', or '/ad-builder'."
---

# Ad builder

Front door to **Yoke Ad Studio**: https://advertisementloop-eight.vercel.app. The Studio holds versions, the Library, review, Share and the Higgsfield key. This skill runs the opening dialogue, then makes the ad through the `yoke-ad-maker` skill or hands the person into the Studio. Never post to Slack from this skill.

## Flow

1. **Start.** Send one line: `Ad builder started.`

2. **Pick a type.** Ask with AskUserQuestion (one question, header `Ad type`): `Static` (4:5 feed by default), `Infographic video` (9:16 kinetic type, 8-14 s), `Higgsfield video` (Seedance 2.5, 4-12 s, real render).

3. **Get the concept.** Ask: `Ready to share your concept? Share now.` Accept anything from one line to a full brief. If they have no concept, offer 2-3 directions in the Yoke voice and let them pick. Load `yoke-brand` and check the concept against the rules below; fix problems in one short line.

4. **Make it.**
   - **`yoke-ad-maker` is available and `AD_STUDIO_TOKEN` is set** (check with `python3 scripts/adstudio.py me`): load `yoke-ad-maker` and follow it. For Higgsfield, follow its "Higgsfield video" section: show the length, format, sound and seconds used this month, render only after a yes, and never re-run a render to retry.
   - **Otherwise:** don't fall back to the Higgsfield connector. It can't generate video, and no other provider is a substitute. Write the concept as a clear ad request (for Higgsfield: one-scene prompt, no on-screen text or logo, plus length and format). Then send:
     - `Open Ad Studio: https://advertisementloop-eight.vercel.app/create` -> pick the type -> paste the request.
     - For Higgsfield, press Generate there. It renders and saves a version.
     - To let Claude render and save directly next time: Ad Studio -> Connect Claude, and install the `yoke-ad-maker` skill.

5. **After.** Give the ad's link. Review and approval happen in the Studio: Share, Download, Approve.

## Brand rules to check the concept against (mirror of the Studio's)
- Name is always `Yoke`, never `Yoke GTM`, `YokeGTM`, `Yoked`.
- Only claim what Yoke does today: LinkedIn prospecting from each rep's own profile (invites, profile views, follow-ups), InMail follow-up to open profiles, drafted replies you approve or edit, approval settings per playbook, Today list of promised follow-ups with snooze, sending limits per LinkedIn account, workspaces with teammates, LinkedIn and Sales Navigator imports.
- Never claim: list building for customers, email outreach, signals, autonomous CRM updates, booked meetings, any numbers or rates, customer quotes, unlisted integrations.
- Voice: politely punky. One joke, one problem per ad, then one honest product payoff. Plain words, no hype, no em dashes.
- CTA: `See how Yoke works`. Never invent an offer or destination.

## If something fails
- `higgsfield_not_connected`: the Higgsfield key is missing on the server. Tell Shane.
- `forbidden` on generate: the person isn't a Creator. Tell them to ask Shane for Creator access.
- Render `failed` or `nsfw`: give the reason, offer a reworded prompt, and confirm before rendering again.
