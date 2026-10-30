# B2 M3 — "You'll follow up when things calm down. So, never." (`ast_b2_m3`, 9:16)

Rebuilt in code from v2 on (Shane, Oct 30). v1 was a Claude Design Motion film (artifact `FMJbmrDN1SgtwCbnukmMJR`),
which the worker can't re-render; v2 keeps its hook, "So, never.", end card, colors, type and logo.
Drawn in canvas, rendered to MP4 (1080×1920, 30 fps, H.264, silent). No generation credits.

- `engine.js`: everything visual. `T` holds the scene timing; `FU` is the follow-up's path through the week and `PUSH`
  when each meeting bumps it; `TITLES` the meetings (fictional). The calendar is a generic week view, no product branding.
- `render.mjs`: `node render.mjs stills 3.4,5.6,6.5` writes check frames; `node render.mjs video out.mp4 poster.jpg`
  renders (poster at `window.POSTER`).
- Uses the font and lockup in `../clay/assets/`.

## Story (v2)

1. 0–2.2s: "You’ll follow up when things calm down."
2. 2.2–8.2s: "This week" calendar. Meetings pop in faster and faster until every slot is full; each time one lands on
   "Follow up with warm leads" it slides later (Mon → Fri 4 PM), then off the week: "Moved to next week".
   A coral counter counts the moves; caption "Every meeting pushes it later."
3. 8.2–9.6s: "So, never." on ink (v1).
4. 9.6–12.4s: the same full week; two lime "Follow-ups sent ✓" land Tue and Thu; "Yoke sends them on the schedule you set."
5. 12.4–14.8s: Yoke logo, "Busy weeks still get follow-ups.", "See how Yoke works" (v1's end card).

## v2 (review f21c3e44)

Shane, two approved notes on v1: the middle should look like a calendar filling up with things popping in, the
follow-up pushed further and further down, ending on "so never"; v1's busy blocks didn't read as a calendar. Hook and
outro kept.
