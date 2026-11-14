# STATUS.md: project state, roadmap, decisions

The durable, non-code record for Family Practice: what's live, how it's run, what's next, and why things are the way they are. `AGENTS.md` covers how the code works; `PRODUCT.md` and `DESIGN.md` cover product truth and the visual system.

**Keep this current.** Any change that ships, any decision made, or any roadmap shift updates this file in the same commit. Write current truth; replace stale lines instead of appending. This repo is public: never put credentials, account IDs, family codes, real children's names, private network addresses or personal infrastructure details here.

Last updated: 2026-11-14

## Live

- Hosted instance: https://spelling.jesklabs.com (listed as "spelling" on jesklabs.com; the in-app name is "Family Practice").
- Runtime: one Cloudflare Worker (`family-practice`) on the Workers Free plan, with Static Assets, SQLite-backed Durable Objects (`FamilyDatabase` per family, `RegistryLimits`, `TtsCache`), and Workers AI for speech. Migrations deployed: `v1`, `v2`, `v3`.
- Deployed version: `main` at the most recent "deploy" entry in the changelog below. Service worker shell `VERSION` = `v8`.
- Observability: Workers Logs enabled (head sampling 1.0). Aggregate stats at `GET /api/ops/stats` (bearer `OPS_TOKEN`; numbers only).
- The operator runs a weekly automated review (uptime probes, error logs, Workers AI usage against the free tier, family/activity counts, GitHub issues) that reports only when something needs attention.

## Configuration

| Item | Where | Notes |
|---|---|---|
| `SESSION_SECRET` | Worker secret | Signs parent cookies. **Keep stable**; rotating it logs out all parents. |
| `IP_HASH_SALT` | Worker secret | Salts hashed IPs for rate limits. Keep stable. |
| `OPS_TOKEN` | Worker secret (optional) | Enables `/api/ops/stats`; 404 when unset. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Worker secrets (pending branch) | Both required for Google parent sign-in; allow exact `/auth/google/callback` redirect. |
| `RESEND_API_KEY` | Optional Worker secret (pending branch) | Emailed codes and opt-in notifications; quota/verified domain required. |
| `APP_ORIGIN` | Worker var (pending branch) | Canonical HTTPS email-link origin; self-hosters must override the hosted default. |
| `EMAIL_FROM` | Worker var (pending branch) | Default `Family Practice <spelling@jesklabs.com>`; self-hosters must configure their verified sender. |
| `TTS_SPEAKER` | Worker var (optional) | Aura-1 speaker; default `asteria`. |
| `CF_API_TOKEN`, `CF_ACCOUNT_ID` | Deployer environment only | Token needs Workers Scripts edit (+ zone Workers Routes/DNS for the custom domain). Never a Worker binding. |
| Custom domain | Workers Custom Domains | Attached once; `deploy.mjs` does not manage routes. `workers_dev = false`. |

MCP connections need no new secrets, bindings, accounts or registry migration. Their rows and request/write counters live in the existing family DO. Connection tokens survive PIN changes; revoke explicitly.

Free-tier budgets the app enforces itself: voice cache misses 6,000 chars/day global, 1,500/family/day, 2,000/IP/hour; family creation 5/hour/IP plus a global daily cap; unknown-code lookups and PIN failures throttled. Workers AI free allowance is 10,000 neurons/day (Aura-1 ≈ 1,364 neurons per 1k characters).

## Release checklist

1. `node --test` (all green).
2. Local Worker (`cloudflare/deploy.md` → "Local real Worker"), then `node cloudflare/smoke.mjs`, `node cloudflare/ui-smoke.mjs`, and for layout changes `node cloudflare/practice-layout-smoke.mjs`.
3. Bump `VERSION` in `cloudflare/public/sw.js` for any shell change.
4. `node cloudflare/deploy.mjs --dry-run`, then deploy with credentials.
5. Production smoke against the hosted URL (creates and deletes two throwaway families; respects the 5/hour creation limit, so don't loop it). Set `SMOKE_EXPECT_AI=1`.
6. Push `main`, add a changelog line below, and update "Live" if anything structural changed.

## Pending branch: optional parent sign-in and email

Prepared on `signin`, **not deployed**. Optional parent Google/emailed-code sign-in links family spaces without removing Family Code/PIN-only access. Linked accounts provide recovery and opt-in weekly summaries, class updates and review reminders; child accounts remain prohibited. Unlinked lost codes cannot be recovered. Email helpers use one provider request with no automatic retries; AccountStore owns durable delivery claims and quotas. Provider identity/email are additional optional data processors, not analytics.

Deployment preparation adds `ACCOUNTS` → `AccountStore`, additive migration `v4` (v1–v3 preserved), `accounts.js` and `emails.js` modules, and hourly cron (`0 * * * *`). Live section above still describes production, not this branch. Google OAuth and Resend deliveries require operator setup and remain unverified against real providers.

## Roadmap

**Done on pending branch**
- Optional parent Google/email-code sign-in, linked-family code recovery, preferences and opt-in hourly email processing; AccountStore migration v4 and shell v9 (not deployed).
- Private-by-link spelling snapshots and single-admin class feeds, independent imports with optional verses, family follows, client-side QR, MCP sharing tools, and additive `v3` ShareStore migration (live 2026-11-14).
- Parent-only management page, mobile editor sheets, and per-family MCP assistant connector.

**Next up**
- Real-device pass on iPhone (installed PWA): header safe area, haptics, key sound, Aura playback after first tap.
- Verse spaced repetition: extend the Leitner bank to verses, keyed by the current wording.
- Parent view of the word bank: per-word box and due date, and the ability to retire or reset a word.

**Later / ideas (need a decision before starting)**
- Auto-generated kid-level example sentences for bare word lists: needs an LLM cost/quota review and parent review of the output.
- A "daily practice" home: review due words, then the current list, then a verse, in one tap.
- Backups: a gentle reminder to export, or optional encrypted cloud backup without collecting identity.
- Multi-admin classroom/roster/school-account mode: **not planned**. Single-admin class-list publishing is the deliberately limited sharing feature (see decisions).
- Rename in-app branding to match "spelling" on jesklabs.com: undecided.

## Decisions

Newest first. Each entry gives what was decided and why; if a decision is reversed, edit the entry and say what replaced it.

- **2026-11-14 (pending): Optional parent identity, never kid accounts.** Google and emailed-code sign-in may link existing families and recover linked codes. Code/PIN-only access remains supported. Verified parent email is allowed only for account features and opt-in summaries/notifications; unlinked lost codes still have no recovery. This supersedes the earlier blanket no-email/no-login decision.
- **2026-11-14: Share links, not a public library.** Owner-approved bearer links carry immutable spelling snapshots with sentences and an optional parent-selected verse; never identity or progress. Links never expire unless the owner stops them. Imported copies remain independent.
- **2026-11-14: Single-admin class lists are publishing feeds.** One creating family can append immutable weeks; other families choose which kids receive copies. No school accounts, rosters, search, multi-admin editing, or remote changes to imported copies. This narrowly replaces the earlier blanket “no teacher/class mode” decision, without expanding into classroom management.

- **2026-11-14: Suppress accidental zoom on the child practice desk.** Viewport scaling limits, manipulation touch behavior, iOS pinch guards and ≥16px form controls prevent zoom from disrupting practice. Single-finger scrolling and rem-based OS text sizing remain; pinch magnification is intentionally restricted (accessibility trade-off documented in DESIGN.md).
- **2026-11-14: Parent tools live on a separate page, not in kid tabs.** Wrapping section controls keep every tool reachable on a phone; sheets scroll independently of their visible action footer.
- **2026-11-14: MCP uses per-family scoped connection tokens, not accounts/OAuth.** Only token hashes are stored; the embedded non-reversible family hash routes without scanning. Uses the legacy initialize lifecycle (`2025-11-25`); the current `2026-07-28` protocol removes that handshake and is not advertised. No delete tools, aggregate progress only, 60 requests/min/token and 20 writes/hour/family. PIN changes deliberately keep assistant access until explicitly revoked.
- **2026-11-14: Learn has no intro screen; the stage tabs are the navigation.** Tap any stage to jump to it; a forward jump is recorded as a skip and never credits learning. *Why:* parent testing found the intro page redundant and a separate "Skip to recall" button duplicative once the tabs work.
- **2026-11-14: Learn stages scale with word length and never demote.** 1–3 letters get 2 stages, 4–5 get 3 and 6+ get 4. A miss shows the word, then retries the same stage. A first-try Fade jumps to Recall. *Why:* parent testing found the fixed 4–5 steps drawn-out and step-backs punitive.
- **2026-11-14: Spaced repetition uses Leitner boxes (1/2/4/7/14/30 days), not FSRS.** *Why:* weekly spelling lists are small, and "this word is in box 2" is explainable to kids and parents. It is deterministic, cheap to compute in each family DO, and backfilled from history. FSRS suits large card decks.
- **2026-11-14: Learn mode uses Copy–Cover–Compare and vanishing cues (fading letters).** *Why:* both are evidence-based spelling methods. Learn attempts are tracked separately so test accuracy stays honest.
- **2026-11-14: Custom on-screen keyboard, key sound and haptics on touch devices, on by default.** This follows the approach in the author's Incord app. *Why:* the custom keyboard keeps OS autocorrect from interfering with spelling, and kids respond to tactile feedback. Each device can turn these off.
- **2026-11-14: Visual system from an impeccable design pass** (`PRODUCT.md`, `DESIGN.md`). *Why:* it replaced a generic-AI look with focused practice screens for kids.
- **2026-11-14: Open-sourced under MIT with fresh history.** *Why:* trust for parents and contributions. Earlier history contained personal details, so it was not published.
- **2026-11-14: Installable PWA**; the shell is cached and family data stays online-only. *Why:* families use phones and tablets, and no family data should sit in shared caches.
- **2026-11-13: Voice is Workers AI Deepgram Aura-1 with a two-tier cache.** *Why:* browser speech is poor or missing on Linux Chromium. MeloTTS is deprecated on 2026-11-20. The shared cache keeps the per-character pricing within the free tier.
- **2026-11-13: Public, Family Code plus per-family Parent PIN, child first names only.** Optional parent accounts are now approved on the pending signin branch (2026-11-14); code/PIN-only use remains supported. *Why:* zero setup friction and no identity data to protect. Lost code means lost data, which is mitigated by printable codes and exports. An earlier Google-login gate was removed.
- **2026-11-13: Parents run it for their own kids, not school accounts.** Approved single-admin class-list feeds (2026-11-14) let families exchange practice material without rosters or school-managed student data.
- **2026-11-13: Cloudflare Workers Free instead of a VPS or Vercel.** *Why:* the free tier with built-in SQLite DOs and AI, and a public kids' app shouldn't share a host with private services.
- **2026-11-13: Parents paste verse text; no Bible API.** *Why:* translation licensing. Samples use public-domain KJV.
- **2026-11-13: Zero npm runtime dependencies, vanilla JS, no build step.** *Why:* small, auditable, easy for agents and self-hosters.

## Changelog — pending

- `signin`: optional parent identities and code recovery; Family Code/PIN-only access unchanged. Singleton AccountStore v4, Google state/PKCE flow, hashed emailed codes, masked family links, opt-in Sunday 5pm weekly summaries, Tuesday/Friday review nudges and hourly batched class updates, signed one-click unsubscribe, numeric mail counters and a 500/day reservation cap. Google/Resend live delivery and production cron are unverified; no production changes made.
- Verification: 142 unit tests, uploader zero-network dry-run, local email-sink recovery smoke (76 checks), core API smoke (53 requests/65 assertions), desktop/mobile UI and parent/practice/sharing layout smokes pass. Sign-in UI smoke passes 135 assertions at desktop and 390×844, saves 30 screenshots plus two email HTML samples, and reports zero console/CSP/third-party-request errors. Independent auth review findings were fixed with regressions (pending-link revocation, safe Lock, auth lookup throttles, full multi-family digests).

## Changelog (deploys)

- 2026-11-14 sharing: share links (`/s/…`) and single-admin class lists (`/c/…`) with QR, follows and new-week cards, multi-kid imports with optional verse, MCP `get_shared_list`/`import_shared_list`, reports; ShareStore migration v3 applied; shell v8. Live checks: unknown share/class → 404, share pages `noindex`; core prod smoke passed (53 requests / 64 assertions). Sharing smoke against prod pending (family-creation rate limit). Smokes no longer send `CF-Connecting-IP` to non-localhost targets (Cloudflare rejects it).
- 2026-11-14 `696881b`: separate Parent page (kid view keeps 3 tabs); mobile parent sheets with pinned Save/Cancel and bounded textarea; MCP connector (per-family bearer connection links, add/read or read-only, 7 tools, revoke; protocol 2025-11-25); pinch/double-tap/auto-zoom and overscroll disabled; invocation URL logging off. Live checks: bogus token → 401, foreign Origin → 403, GET → 405; full prod smoke passed (53 HTTP requests, 64 assertions, including live MCP tools/scopes/revocation).
- 2026-11-14 `5116a93`: Learn starts straight from the list (intro page removed); stage tabs are tappable to jump between stages (forward jumps logged as skips); bottom "Skip to recall" removed.
- 2026-11-14 `c6d0989`: Learn stages by length, no demotion, fast-track, skip to recall / start test; Leitner Review + word bank; safe-area practice band; kid-facing voice status removed; smoke cleans up in `finally`.
- 2026-11-14 `fd730f7`: impeccable redesign, on-screen keyboard, key sound + haptics (default on).
- 2026-11-14: PWA, mobile pass, Learn mode, ops stats, Workers Logs on; repo made public.
- 2026-11-13: Aura-1 cloud voice + `TtsCache` (migration v2).
- 2026-11-13: first public multi-family deploy.
