# Clay counter-positioning series

Five ads, each in 9:16 and 4:5, drawn in code (canvas) and rendered to MP4. No generation credits.

| Library asset id | Spot key | Ratio |
| --- | --- | --- |
| `ast_clay_setup_9x16` / `ast_clay_setup_4x5` | `setup` | 9x16 / 4x5 |
| `ast_clay_credit_*` | `credit` | |
| `ast_clay_pipeline_*` | `pipeline` | |
| `ast_clay_repair_*` | `repair` | |
| `ast_clay_output_*` | `output` | |

Asset ids follow `ast_clay_<spot>_<ratio>`.

## Files

- `engine.js`: everything visual. `LAYOUT` (per ratio), `rainbowRest` (the clay rainbow), `drawTube` (clay shading), `drawHeadline`, `drawEndCard`, and `SPOTS.<key>` (each spot's gag, `cut` time and `total` length).
- `render.mjs`: `node render.mjs <spot> <9x16|4x5> stills 0.5,2,3.9` writes check frames; `node render.mjs <spot> <ratio> video out.mp4` renders the video (30 fps, H.264). One render takes about 1-2 minutes.
- `assets/`: Yoke lockups (unchanged brand SVGs) and Instrument Sans (OFL).

## Shared timing (approved by Shane, Oct 29)

- Headline band on top: small kicker "Go-to-market engineering:" over the problem line.
- Gag runs 0-4.0s. Hard cut to the Yoke end card at exactly 4.0s. 7.0s total.
- End card: Ink background, reversed lockup, "Go-to-market engineering should be easy.", coral "Start today" button.

A change to a shared function (headline, end card, rainbow, shading) changes every spot. When feedback is about one spot,
keep the change inside that spot (`SPOTS.<key>` or a per-spot option) unless the feedback says it applies to the series.

## Output 9x16 v5 (job a67087d0, review 24b70244)

No hand. Cursor hits play, pressure surges through the clay tubes, the tubes burst like a pipe, clay sprays all over
the screen, the rainbow collapses, then "Done". 9:16 only (`outputBurst`); 4:5 still uses the v4 kneading gag (`drawKnead`).
