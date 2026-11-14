# AGENTS.md — Family Practice

Read this before changing the project. Update this file when architecture or product constraints change. Project state, deploy/config, roadmap, decisions and changelog live in `STATUS.md`; update it in the same commit as any release, decision or roadmap change. `CLAUDE.md` is a symlink to this file; preserve it.

## Product and privacy

Family Practice helps families practice weekly spelling lists, memorize parent-provided Bible verses, and review progress. Built by a parent for his own kids; the hosted instance is https://spelling.jesklabs.com.

- Spelling: word → sentence → word, one retry, letter-by-letter reveal, missed-word rounds, and cross-list tricky words.
- Verses: read/listen, progressive blanks, first letters, memory typing, and reference quiz. Mastery is tied to the current wording.
- Progress: first-try accuracy, missed words, verse mastery, and practice streaks.
- The multi-family build uses a Family Code for kid access and a per-family Parent PIN for edits. No email, login provider, or recovery service: reduce setup friction and avoid collecting identity data. Lost code means lost access; support printed codes and backups.
- Collect only first names or nicknames and optional grade labels. Do not add last names, email, birth dates, schools, or photos.
- Designed for parent-managed family use, not classrooms. Teacher/class features require a separate privacy and product review.
- No analytics, ads, trackers, external fonts, or third-party browser requests. Keep CSP and DOM escaping intact.
- Parents provide verse text to avoid translation licensing/API dependencies; do not fetch copyrighted Bible translations. Included samples use public-domain KJV.
- Keep operation within free-tier limits by default; review costs before adding paid services.

## Two self-hosted builds

| Path | Build |
| --- | --- |
| `cloudflare/` | Multi-family Worker with Static Assets and SQLite-backed Durable Objects |
| `server.js`, `public/`, `lib/tts.js`, Docker files | Single-family Node 24 app for a trusted LAN, with optional Wyoming/Piper speech |

Keep both builds working and tested. `lib/practice.js` is shared answer checking, verse comparison, and tricky-word logic. The Node build seeds fictional Sam/Alex profiles with blank grades and sample practice material. The Worker starts families empty.

## Worker architecture and limits

- `cloudflare/worker.js` routes assets and APIs. `cloudflare/core.js` holds per-family storage and practice API logic.
- One `FamilyDatabase` Durable Object per hashed Family Code; never log raw codes or use them as object names.
- Optional private `GET /api/ops/stats` uses an independent `OPS_TOKEN` bearer and returns only numeric aggregates (no identifiers/content). Family reports register families lazily; never claim dormant historical families are counted. See deploy.md for response/coverage.
- Learn sessions use kind `learn`, attempt mode `learn`, and stored `step` 0/50/75/100 (legacy 25 and request `level` alias accepted); 1–3 letters use 0/100, 4–5 use 0/50/100, and 6+ use all four stages. Misses compare then retry the same stage; first-try Fade success jumps to Recall, which alone completes learning. A `skip` step records shortcuts without correct/first-try credit. Learn history is separate from test scores and completed test lists; learning counts toward practice streaks. Old attempts migrate to test/0.
- Worker spelling Review uses a per-kid, normalized-word Leitner bank (boxes 1–6; 1/2/4/7/14/30 UTC days), persisted inside each family SQLite DO and backfilled deterministically from attempts. Review sessions use kind `review`, test-mode attempts, max 15 due words, and the same one-retry voice/keyboard flow. Pure scheduling lives in `lib/practice.js`; the LAN build retains its existing tricky-word flow. No new binding or deployed migration is needed.
- MCP is stateless Streamable HTTP at `/mcp/t/<token>` or `/mcp` with `Authorization: Bearer <token>`. Tokens are `fp_<64-hex-family-hash>_<256-bit-random-hex>`: the non-reversible family hash routes directly to its DO without revealing the Family Code or scanning a registry. The family DO stores only SHA-256 token hashes plus connection metadata; never log/backup plaintext tokens. Parent-unlocked connection APIs manage at most five named connections. Scopes are `add-read` (default) and `read-only`; neither allows deletion. PIN changes keep connections; explicit revoke/revoke-all and family deletion invalidate them.
- MCP uses protocol `2025-11-25` (also negotiates `2025-06-18` and `2025-03-26`), JSON-RPC 2.0 JSON responses, no SSE/session state/OAuth, no batches, exact-origin checks when Origin is present. Limits: 256 KiB bodies, 60 requests/minute/token and 20 writes/hour/family; shared core validation and storage enforce the existing content limits and family boundaries. Assistant results expose aggregate progress, never raw typed answers.
- Parent management is its own slate page with six wrapping section controls; kid navigation always has exactly three tabs. Parent forms use a scrollable sheet body with fixed/sticky actions and iOS-safe full-width dates. Bump the shell version with UI changes.
- `RegistryLimits` enforces family creation and unknown-code throttling using salted IP hashes. PIN throttling lives inside each family object.
- Parent cookies are HMAC-signed using `SESSION_SECRET`, family-bound, and invalidated by PIN changes. PIN hashes use salted PBKDF2.
- Limits: 10 kids/family, 200 lists, 100 current words/list, 300 verses, 2,000 characters/verse, and the newest 50,000 attempts. Preserve bounded session history and import limits; see `cloudflare/deploy.md`.

## Voice

- Browser speech quality/availability varies, particularly on Linux Chromium; cloud speech provides a consistent default, with device fallback to keep practice available.
- Worker: Cloudflare Workers AI `@cf/deepgram/aura-1`, default speaker `asteria` (override `TTS_SPEAKER`), MP3 through `/api/tts`; device speech on failure/quota or explicit selection.
- Cache: `caches.default` → SQLite `TtsCache` → AI. Keys include model, speaker, encoding, language, and text hash. Validate MP3 signatures; max clip 512 KB, durable LRU cap 400 MiB.
- Cache-miss character budgets: 6,000 globally/UTC day, 1,500/family/UTC day, 2,000/hashed IP/hour, 300/request. Failed inference counts; cache hits do not. Account-wide free quotas can change independently.
- Migration `v1` creates family/registry objects; additive `v2` creates `TtsCache`. Never rewrite deployed migration history.
- Node: `PIPER_HOST` defaults empty and must be explicitly configured for Piper synthesis. Standard Wyoming port is 10200. Without Piper, use browser speech; never embed a private network endpoint.

## Development and checks

- Node 24+, zero npm runtime dependencies, vanilla JS, no build step. Preserve this unless a clear need warrants review.
- Run `node --test` before deployment or merging behavior changes. Use temporary test data and fake speech services, not real family data.
- `node cloudflare/deploy.mjs --dry-run` prepares a deployment with zero network calls.
- `cloudflare/smoke.mjs` checks local Wrangler APIs; `cloudflare/ui-smoke.mjs` checks local browser journeys. `cloudflare/parent-layout-smoke.mjs <dir>` verifies separate Parent navigation, three fitting kid tabs, date/field bounds and always-visible editor actions at 390×844, 360×740 and desktop, including connection creation screenshots. `cloudflare/practice-layout-smoke.mjs <dir>` checks 16/25/40-word headers at 390×844, 360×740 and desktop, simulates a 47px top safe area, verifies Fade fast-track, and captures Test/long-word Fade/4-letter Fade screens. It uses the same optional Playwright setup and disposable localhost Worker as UI smoke; actual iOS standalone still needs a device check. Keep localhost guards and Wrangler telemetry disabled.
- Use text nodes for user data, parameterized SQL, origin/JSON checks, and bounded inputs. Do not weaken family isolation or parent authorization.

## Deployment

- Worker setup: `cloudflare/deploy.md`; Node/Docker setup: `README.md`.
- The Worker uploader requires `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `SESSION_SECRET`, and `IP_HASH_SALT` in the environment. Do not commit credentials, family codes, backups, private addresses, or operator-specific configuration.
- Keep `SESSION_SECRET` and `IP_HASH_SALT` stable across deployments. Domain configuration is separate from the uploader; use your own hostname.
- Deploy only to the intended operator-controlled environment with authorization. Local preparation and dry-run need no account access. Production smoke tests create/delete data and must be separately scoped; never remove local test guards for routine verification.

## PWA/mobile release constraint

Cloudflare shell is installable; see `cloudflare/PWA.md`. Visual system: `DESIGN.md` (product truth: `PRODUCT.md`). Fonts and the key-sound sample are self-hosted under `cloudflare/public/{fonts,audio,licenses}`; keep licenses beside them. `feedback.js` owns per-device key sounds/haptics (never before a gesture) and `keyboard.js` the touch on-screen keyboard. `cloudflare/screens.mjs <dir>` captures review screenshots from a local Worker. Bump `VERSION` in `cloudflare/public/sw.js` for every shell release. CacheStorage holds public shell only, never family URLs or API data; GET TTS reuse is bounded, volatile memory. Family loading/saving remains online-only. `pwa.js` owns install/mobile hooks independently of app state.
