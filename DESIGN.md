# Design: Family Practice (Cloudflare PWA)

World: **seed packets**. Every section is a flat printed band of colour; lists and verses are packets with their name set big; a child's practice screen is a focused desk. Source of truth: `cloudflare/public/style.css` tokens. Direction contract: `.impeccable/surfaces/cloudflare-public-index-html.md`.

## Colour (Restrained-to-Committed: colour owns regions, not accents)
| Token | Hex | Job |
|---|---|---|
| `--ground` | #F2F3EE | page ground (cool, never cream) |
| `--stock` | #FFFFFF | packets, fields, keys |
| `--ink` / `--ink-2` | #18212C / #4A5563 | text / secondary text (≥4.5:1 on ground) |
| `--cobalt` | #2446A8 | Spelling band, landing, brand |
| `--madder` | #A8322B | Bible Verses band |
| `--leaf` | #2B6A42 | Progress band, first-try success |
| `--slate` | #1F2A37 | Parent / kid picker band |
| `--marigold` | #F2B33D | **only** "you are here": focus ring, current word cell, hidden-letter line, pressed key, missed cell |
| `--retry` / `--retry-soft` | #8A4708 / #FCEFDC | gentle retry feedback |
Section tone is set with `data-tone` on `#app` (spelling, verses, progress, parent) and drives `--tone`.

## Type (self-hosted, OFL, CSP 'self')
- **Practice Reader** (renamed Latin subset of Andika 6.101, SIL): body, target words, verses, the keyboard. Single-storey a/g for early readers. Answer field 2.4–4.2rem.
- **Barlow Condensed** 600/700: headings (uppercase for H1/band titles), buttons, tabs, labels in bands.
- Licenses: `cloudflare/public/licenses/`.

## Components
- **Band**: full-bleed tone field with H1 and file-tab section nav sitting on its lower edge.
- **Practice band**: non-shrinking exit (×) on its own row, title, status, one cell per word (thin segments above 12 words); sticky opaque band includes the top safe-area inset (`.chart-cells`, the signature "planting chart").
- **Learn stages**: numbered, labelled Copy → Fade → Fade more → Recall path under the prompt (1–3 letters: Copy → Recall; 4–5: Copy → Fade → Recall; 6+: all four). Misses retry the same stage after comparison; first-try Fade success skips to Recall. Cobalt filled = complete; marigold with ink rule + `aria-current="step"` = you are here; outlined = next. These are within-word steps, never the band’s per-word squares.
- **Word bank**: ruled three-column counts (Learning, Getting it, Mastered), then compact word rows; no additional card grid.
- **Packet**: white stock, tone strip header, no shadow. Featured item only; everything else is ruled rows (`.rows`) under a 2px ink section rule (`.section-title`).
- **Buttons**: tone fill (primary), white with rule (secondary), underlined text (quiet). 10px radius, ≥44px (≥48 default, 56 on the desk). No pills except `.segments`.
- **Keyboard** (`keyboard.js`): docked at the bottom of the desk on touch; white keys on #DFE2DA, marigold pressed state, primary action as the widest bottom key.
- **Icons** (`icons.js`): one 24px, 2px round-stroke set. No emoji.

## Motion and feedback
- One authored moment: landing demo letters fade into marigold blanks. Everything else is ≤150ms state change; `prefers-reduced-motion` disables all of it.
- Key sound (Kenney CC0 tick) and haptics are per-device, default on (kids like the click; Incord defaults off), never before a gesture. iOS haptics use a transparent native `<input switch>` overlay on every button.
