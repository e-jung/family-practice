---
version: 1
slug: "cloudflare-public-index-html"
primary_target: "cloudflare/public/index.html"
related_targets: ["cloudflare/public/app.js","cloudflare/public/style.css"]
---

# Surface brief: Family Practice app shell (Cloudflare PWA)

Scope: every screen in cloudflare/public (landing = Persuade, light touch; kid picker, lists, practice, progress, parent = Operate; practice screens are a child's focused desk).
Audience/job: kids 6–11 doing one word or verse at a time; parents setting up weekly. Constraints: vanilla JS, CSP 'self', self-hosted OFL fonts, 44px+ targets, reduced motion.
Run note: unattended (delegated agent); no decision page could be answered. Assigned direction built as dealt; challengers weighed in-thread.

## Direction contract

THESIS: Every list and verse is a seed packet: a flat band of colour with its name set big, and a planting chart that tracks each word. Refuses the cream-card-and-emoji family-app default.
OWN-WORLD: White packet stock on a cool pale ground. Flat printed bands in Cobalt (spelling), Madder red (verses), Leaf (progress) and Ink (parent), with Marigold reserved for "you are here" (focus, current letter, pressed key). Barlow Condensed caps for bands and headings; Andika (beginning-reader a/g) for words, verses and body. Square-shouldered 10px radii, hairline rules instead of boxes, and no pills except small controls.
STORY: Parent understands it's free, private and quick to set up, then creates a space. Kid picks their name, sees this week's packet, taps Learn or Test, and spells one huge word at a time.
FIRST VIEWPORT: Practice = the section-colour band (exit, title, progress cells, one per word), the target area with the answer at 2.6–3.4rem Andika, the listen controls, and on touch the docked keyboard with Check as its widest key. Landing = cobalt field, condensed headline, a live demo packet fading "beautiful", and the Create/Join actions below it.
FORM: Heirloom seed packet, candidate 6 of 7; seed:cb4239f0e1c55f01. Raises: type-as-interface (from metro tiles: remove card chrome); flat colour owns regions (from zoo map); length encodes quantity, one cell per word (from Labanotation); nothing labelled twice (from Saville); a finite roster with fixed furniture for the kid picker (from character goods); target word by scale contrast alone (from variable-font specimen, competitive).
Signature move: the planting chart, a row of cells (one per word) in the band that fills leaf/marigold as the round goes.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
