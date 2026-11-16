# Verification

## 2026-11-16 — phase 1 guardrails and LAN retirement

The Cloudflare Worker is now the only supported build. `lan-build-final` preserves
the retired LAN source. `lib/practice.js`, its tests and `cloudflare/tts.js` remain.
The local `npm run check` runs all retained tests and the shrinking source gate;
regression fixtures verify rejection of oversized files and new long lines.
The isolated staged phase-1 artifact passed 160 tests on Node v24.22.3, with
48 existing source offenders baselined (630 long lines; `app.js` is 1,632 lines).
The baseline comes from the pre-change HEAD, not concurrent phase-2 edits.
No deployment, network request, push or live app behavior change is part of phase 1.

## Historical verification — 2026-11-14 · Learn stages and spaced Review

Node **v24.22.2**, zero application runtime dependencies. All checks used fictional, disposable data. No push, deployment, production requests, Cloudflare account APIs, or real AI inference. Wrangler telemetry was disabled; the local config omitted the remote AI binding.

## Automated suite

`node --test`: **68 passed, 0 failed/cancelled/skipped/todo** (previously 60).

At that release, both Node/LAN and Worker builds were covered (the LAN build is now retired). New coverage includes Leitner promotion/cap/demotion/retry behavior, Learn recall limits and skipped attempts, normalized cross-list merging, kid isolation, historical/archived review references, 15-word ordering/cap, UTC midnight/leap-day/year/DST boundaries, metadata and exposure counters, deterministic backfill equality with live updates, one-time backfill, backup preservation, and early Learn-to-Test exits. Cued Learn introduces box 1 but does not earn recall credit. Skip markers are counted separately from real Learn attempts.

## Real local Worker / Miniflare

Wrangler **4.161.0**, fresh disposable persistence, test-only secrets:

- `cloudflare/smoke.mjs`: **33 HTTP requests / 30 assertions**, including two families, spelling/verse attempts, progress, backup restore, isolation and deletion.
- Smoke-created families are tracked and deleted in `finally`, including assertion failures. HTTP 429 creation failures explain the local quota/reset options. Mocked failure checks additionally exercised cleanup and rate-limit diagnostics.
- The browser fixture ages exported attempts, removes the derived bank snapshot, and imports through the supported API to exercise actual historical replay and due-word scheduling.

## Headless Chromium

`cloudflare/ui-smoke.mjs`: **two complete journeys**, desktop **1440×1000** and touch/mobile **390×844**. **32 normal Learn-stage submissions** plus recall shortcuts; **7 on-screen key taps**.

- Numbered Copy → Fade → Fade more → Recall stages, short-word two-stage path, exactly one accessible/current stage, intentional miss/backtracking, summary, skip-to-recall, honest skip records and same-list Learn-to-Test shortcut.
- Due Review session, test-style flow, next-review empty state, brand-new empty state, word-bank groups, and parent data.
- Existing onboarding, spelling retries/spell-out/results, verses, progress, family switching/join/privacy, PWA manifest/icons/service-worker activation, key sounds and iOS switch-overlay coverage retained.
- **Zero unexpected console/page errors or third-party requests.** Deliberately mocked HTTP 503 audio failures are expected browser resource diagnostics, excluded from unexpected errors.
- Mocked real MP3 decoding/playback, device speech instrumentation, timeout/503 fallback, pitch preservation, replay cache/prefetch and navigation cancellation remain covered (**13 successful mocked cloud requests / 6 mocked 503 requests**). Audio was not listened to by a human.

`cloudflare/srs-screens.mjs [output-directory]`: **14 screenshots** at mobile **390×844** and desktop **1280×900**: Review entry, all four Learn stages, focused word bank, full Progress. It also checks **360px overflow** on every captured mobile surface. **Zero console/page errors, zero third-party requests**, and fixture family deleted.

## Release state / unverified

- Service worker shell cache bumped from `v2` to **`v3`**. Strict CSP and first-party-only assets remain unchanged; no new binding or deployed migration.
- `git diff --check` clean. `CLAUDE.md` remains the `AGENTS.md` symlink.
- No physical iOS/Safari/device install or human audio-quality verification. No deployment, Cloudflare account migration, DNS change, real Workers AI/Piper connection, or Docker launch attempted.
- At that release, Node/LAN retained its established tricky-word flow; scheduled Review belonged to the Worker. The LAN build is now retired.
