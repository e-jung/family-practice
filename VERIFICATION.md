# Verification — 2026-11-14

Node **v24.22.2**, zero application runtime dependencies. All validation below used fictional, disposable data. No push, deployment, production requests, Cloudflare account APIs, or real AI inference were performed. Wrangler telemetry was disabled and the local-only config omitted its remote AI binding.

## Automated suite

`WRANGLER_SEND_METRICS=false node --test`

**59 tests passed; 0 failed, cancelled, skipped, or todo.** Includes both Node/LAN and Worker builds; real SQLite/HTTP fixtures; fake Wyoming framing/cache/failure tests; family isolation, PIN/session protections, backup compatibility; mocked cloud voice/cache/quota behavior; deterministic fade masks and Learn state transitions; Learn exclusion from headline test accuracy; private ops authentication/aggregates; PWA PNG/manifest/worker caching behavior; and mocked deployment tests.

## Real local Worker / Miniflare

Local Wrangler **4.161.0** served the integrated build with fresh project-local persistence and test-only secrets. `cloudflare/smoke.mjs` passed **33 HTTP requests / 30 assertions**: two families, spelling and verse attempts, progress, export/restore, parent/family isolation, expected unavailable cloud voice, and deletion.

## Headless Chromium

`cloudflare/ui-smoke.mjs` passed **two complete journeys**, desktop **1440×1000** and mobile **390×844**, plus **360px** overflow checks.

- Onboarding, kid/list creation, spelling retries/reveal/results, verse practice, progress, family switching/join links/privacy, and cleanup.
- **38 Learn attempts** across full/25%/50%/75%/blank cues and a short word's full/blank path, including intentional misses, compare reveal, one-level backtracking, successful completion, and “Take the test now”. Hidden Continue controls cannot skip an unsubmitted cue.
- Manifest parsed, icon assets fetched, and a real service worker activated. First-party CSP remained in effect; **zero console/page errors and zero third-party requests**.
- Real MP3 decoder/playback with mocked first-party audio responses; pitch preservation, replay cache, bounded prefetch, device-voice selection, HTTP 503 and four-second timeout fallback, and navigation cancellation. **9 successful mocked cloud requests / 4 mocked 503 requests.** Device speech was instrumented, not listened to by a human.
- Browser-context interception observes service-worker requests. Cancellation explicitly synchronizes with the delayed network request, avoiding Playwright's action/network auto-wait race.

An additional PWA-focused local Chromium check verified the cached offline shell, install hint, 360px wrapping, and tap targets. Family loading/saving remains online-only; heard audio reuse is volatile and bounded, not a persistent offline library.

## Release preparation

`node cloudflare/deploy.mjs --dry-run`: **zero network requests**, five Worker modules, ten public assets, required secret names plus optional OPS_TOKEN. `git diff --check` clean. Tracked-source audit found none of the targeted personal identifiers, private network endpoint, or private infrastructure paths. CLAUDE.md remains a symlink to AGENTS.md. Historical commits are not sanitized; a public release must use the planned squashed history.

## Unverified / operational limits

- Physical iOS installation, Safari keyboard behavior, and real-device/audio quality require device testing. The app primes and reuses one HTMLAudioElement synchronously inside a user gesture; headless Chromium is not iOS proof.
- No actual deployment, Cloudflare account migration, DNS setup, real Workers AI/Piper connectivity, or Docker launch was attempted.
- Ops aggregates are best effort. Existing families register lazily; dormant pre-feature families and unknown historical creation dates cannot be included until observed. Counts never imply complete pre-feature history. Seven-day voice series is zero-filled; active means at least one practice attempt, not a page visit.
- Cache-first shell releases must bump VERSION in cloudflare/public/sw.js. Set stable deployment secrets, optionally set OPS_TOKEN, and enable GitHub private vulnerability reporting when publishing the repository.
