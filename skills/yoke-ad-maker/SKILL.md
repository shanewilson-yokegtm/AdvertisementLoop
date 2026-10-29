---
name: yoke-ad-maker
description: Create branded Yoke static and video ads in your own Claude, save the real files to the Ad Studio library, share an exact version to Slack, and process feedback on ads you own.
---

# Yoke ad maker

Make ads in your own Claude, save the actual files to Ad Studio, gather input in Slack, and revise with human direction. The web app (https://advertisementloop-eight.vercel.app) is the shared library, comment thread, version history and approval surface.

## What's connected

This skill talks to Ad Studio through `scripts/adstudio.py`. It needs two environment variables in the Claude you're using:

- `AD_STUDIO_API` = `https://advertisementloop-eight.vercel.app/api/v1`
- `AD_STUDIO_TOKEN` = your personal token from Ad Studio > **Connect Claude**. It acts as you, with your permissions, and nothing more.

Run `python3 scripts/adstudio.py me` first. Outcomes:

- It prints your name: connected.
- `not_configured`: no token here. Ask the person to set the variables in their Claude environment. Never ask them to paste the token into the chat, and never print it.
- `api_not_enabled`, `network` or `upload_blocked`: the service or this environment can't reach Ad Studio. Keep making the creative work, then build a handoff bundle (`adstudio.py handoff`) for manual upload in the app. Say exactly what wasn't saved.

Every save, share and feedback result must come from the script's output. If it didn't return an id or link, it didn't happen. Don't invent ids, links or tool names.

## Permissions (enforced by Ad Studio, not by this skill)

- New ads belong to whoever creates them. Owners stay the same through revisions; each version records who made it.
- You may create and revise your own ads, process their feedback, revert them, and share them to Slack.
- You may read every teammate's ad and its full comment thread, and add comments under your own name (`adstudio.py comment`).
- You may not change, process, revert, reject or share someone else's ad. If asked, offer to leave a comment with the suggestion instead. Don't work around it by copying their ad.
- Shane (admin) can process and revise anyone's ad. Taking over changes who processes it, not who owns it.
- Final approval is a separate action in the app, only for approvers. Nothing in this skill approves an ad.

## Create

Read `references/yoke-brand.md` first, and `python3 scripts/adstudio.py get <id>` or the brand pack when continuing an existing ad. Formats: static, infographic video, Higgsfield video, or a mix. When asked for a set without formats, include both static and motion ideas. Respect a requested format.

One recognizable habit, one gentle joke, one honest payoff. Speak to managers and teams as well as owner-operators. Use only the product capabilities in the reference. Never invent features, numbers, offers or customer proof.

Make real files with the tools available here. Check them before saving: readable text, no clipping, logo intact (`assets/yoke-lockup.svg`, `assets/yoke-lockup-reversed.svg`, unmodified), right size, video plays.

- **Static:** PNG or JPEG, plus the editable source (SVG, HTML or a zip of the project).
- **Motion / video:** the real rendered file plus a poster JPG, plus the source (timeline code, HTML, project zip) and any provider job ids in `--meta`.
- **Not finished:** a storyboard, HTML preview, provider job or temporary URL is not a finished video. Save it with `save-pending` and a note saying what's missing.
- **File types:** the script detects the real type. A WebM stays WebM.
- **Higgsfield:** only with a connected tool and approved credits. Otherwise save a pending version with a production brief.

## Save

```
python3 scripts/adstudio.py create --name "<concept>" --kind static|motion|video --format feed45|square|vertical|landscape
python3 scripts/adstudio.py save <asset_id> --file final.png --source source.svg --meta '{"copy":{...},"source":{"concept":"...","tool":"...","prompt":"..."}}'
python3 scripts/adstudio.py save <asset_id> --file final.mp4 --poster poster.jpg --source timeline.zip --meta '{"duration_sec":12,"width":1080,"height":1920}'
```

- **What `save` does:** it uploads the bytes, checks them, and creates the next version. Re-running the same save returns the same version, so it's safe to retry.
- **Revisions:** pass `--parent <exact parent version id>`. If someone saved a newer version first, the save is refused (`conflict`). Show the person, and don't overwrite.
- **After saving:** report the returned version id and its `link`. Saving is not approval.

No connection? `python3 scripts/adstudio.py handoff ./handoff --title ... --format ... --files final.png source.svg --meta '{...}'` writes `handoff.zip` with `handoff.json`. Unknown ids stay null. Tell the person to upload it in the app.

## Share to Slack

Only the owner (or an admin) shares. A question is optional.

```
python3 scripts/adstudio.py channels                      # channels the Yoke app is in
python3 scripts/adstudio.py share <asset_id> --version <version_id> --channel <channel_id> [--question "..."]
```

- **Pick a channel:** use the one the person names from that list. Never guess a channel or post to a broad one.
- **Retries:** saving and posting are separate, so retrying a failed post never re-saves the ad.
- **Replies in the thread:** they come back as comments on that exact version, under each person's name, with a Slack link. Reactions are sentiment, not approval.

## Feedback

Feedback goes to the ad's owner. Nothing runs automatically: comments, Slack replies and reactions never edit an ad or enter anyone's chat.

1. `python3 scripts/adstudio.py inbox` lists your ads with feedback to process. Shane can add `--all` for everyone's.
2. `python3 scripts/adstudio.py process <asset_id>` starts or resumes the shared review. It's the same record the app's **Process feedback** button uses, so work started in one continues in the other. It makes no edits.
3. `get <asset_id>` shows the reviewed version, the latest version, media, source, every comment (author, time, version, timecode, Slack link) and the saved proposal and decisions.
4. Present a short proposal: what's compatible, what conflicts, and what you'd change. Save it with `propose <review_id> --rev N --json '{"summary":"...","items":[{"comment_ids":[...],"kind":"compatible|conflict","change":"..."}]}'`.
5. Wait for the person to choose. "Apply Teng's headline, keep Henry's visual" is enough; don't ask again. Then record exactly that with `approve <review_id> --rev N --decisions '[{"comment_id":"...","decision":"apply|defer|dismiss","note":"..."}]' --instructions "..."`. Undecided or deferred items stay pending.
6. Make the change, then `save <asset_id> --file ... --parent <reviewed_version_id> --review <review_id> --note "<what changed>"`.
7. `complete <review_id> --rev N --version <new_version_id>` resolves only the applied and dismissed comments. Feedback that arrived after the review started stays pending.
8. If it can't be finished, run `status <review_id> --rev N --status failed --message "..."`. The last good version and all feedback stay as they were.

If the helper reports `timeout_unknown_outcome`, the step may have gone through: run `get` and check before repeating it.

`rev` changes after every step. Use the latest value from the previous output. A `conflict` means someone else (owner or admin) changed the review or the ad. Reload with `get` and show the person; never force it.

Revert: `revert <asset_id> --from <old_version_id> --latest <current_latest_id>` makes a new version from the old one. History stays.

To start the work in the app instead, press **Execute changes** there. Ad Studio's revision worker then makes the version, within the hour.

## Wrapping up

At a natural end, run `inbox` once. If there's feedback on your own ads, offer: "There's feedback waiting on <ad>. Want to process it?" For Shane, include other owners' work only if he opened the admin view or took it on. If you couldn't check, say so; don't claim it's empty. This skill can't wake up later; promise a reminder only if a scheduled task actually exists.

Leave the person with links to what was saved, the version ids, what feedback remains, and who acts next.

App bugs and ideas go through the app's **App bug or idea** button, not here.
