# B2 M2 — "We should do more on LinkedIn." (`ast_b2_m2`, 9:16)

Rebuilt in code from v2 on (Shane, Oct 30). v1 was a Claude Design Motion film (artifact `2HEZMv52v9HWNvHhpNumJ8`),
which the worker can't re-render; v2 keeps its hook, end card, colors, type and logo.
Drawn in canvas, rendered to MP4 (1080×1920, 30 fps, H.264, silent). No generation credits.

- `engine.js`: everything visual. `T` holds the scene timing, `POSTS` the chat messages and when each reaction lands
  (names fictional), `drawEndCard` the end line. Reactions are drawn shapes, not emoji, so renders don't depend on fonts.
- `render.mjs`: `node render.mjs stills 1.6,5.2,8` writes check frames; `node render.mjs video out.mp4 poster.jpg` renders
  (poster at `window.POSTER`).
- Uses the font and lockup in `../clay/assets/`.

## Story (v2)

1. 0–2.4s: "“We should do more on LinkedIn.”" / "Your team channel, every few weeks".
2. 2.4–9.2s: a `# sales-team` chat. Months apart, the same idea comes up again and again: thumbs-up, "Did we ever get to
   that LinkedIn thing?" with question marks, the same line again, then "Ok we REALLY need to…". The header chip
   "LinkedIn messages sent: 0" never moves and turns coral at the end.
3. 9.2–12.2s: "With Yoke": each rep's LinkedIn sending profile flips from Paused to Running (v1's beat).
4. 12.2–14.8s: Yoke logo, "Do more on LinkedIn. Actually.", "See how Yoke works" (v1's end card).

## v2 (review 1d99721f)

Shane's voice note on v1: the task-list middle wasn't landing; make it feel like a team chat where someone says "we
should do more on LinkedIn", everyone thumbs it up, later "did we ever get to that?" with question marks, then the same
line again, and it never gets done. Hook line kept; its subline and the "Week 7" tag changed to fit the chat.
