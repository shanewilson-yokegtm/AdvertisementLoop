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

There is one kind of feedback. The owner approves or rejects each item; **Process** sends every approved, still-open
item on the ad (from any version, whenever it arrived) into the next version. Undecided items wait.

1. `python3 scripts/adstudio.py inbox` lists your ads with feedback waiting. Shane can add `--all` for everyone's.
2. `get <asset_id>` shows every feedback item (author, time, version, timecode, Slack link, `decision`) and the latest version.
3. Summarize the open items and suggest which to approve. Wait for the person to choose; "approve Teng's, reject Henry's" is enough.
4. Record each choice: `decide <asset_id> <feedback_id> approved|rejected|undecided [--reason "..."]` (same as the app's Approve / Reject).
5. `process-approved <asset_id> [--note "anything else"]` queues the next version with all approved items (same as the app's **Process approved feedback**). The revision worker makes it within the hour.
6. If you're making the version yourself instead: `get` shows the new review id and its `rev`. Make the change, then
   `save <asset_id> --file ... --parent <latest_version_id> --review <review_id> --note "<what changed, item by item>"` and
   `complete <review_id> --rev N --version <new_version_id>`. Every approved item must be addressed in the new version.
7. If it can't be finished: `status <review_id> --rev N --status failed --message "..."`. The last good version stays and the feedback stays approved.

If the helper reports `timeout_unknown_outcome`, the step may have gone through: run `get` and check before repeating it.

`rev` changes after every step. Use the latest value from the previous output. A `conflict` means someone else (owner or admin) changed the review or the ad. Reload with `get` and show the person; never force it.

Revert: `revert <asset_id> --from <old_version_id> --latest <current_latest_id>` makes a new version from the old one. History stays.

In the app the same flow is Approve / Reject on each item, then **Process approved feedback**.

## Wrapping up

At a natural end, run `inbox` once. If there's feedback on your own ads, offer: "There's feedback waiting on <ad>. Want to process it?" For Shane, include other owners' work only if he opened the admin view or took it on. If you couldn't check, say so; don't claim it's empty. This skill can't wake up later; promise a reminder only if a scheduled task actually exists.

Leave the person with links to what was saved, the version ids, what feedback remains, and who acts next.

App bugs and ideas go through the app's **App bug or idea** button, not here.
