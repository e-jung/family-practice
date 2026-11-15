# STATUS.md: project state, roadmap, decisions

The durable, non-code record for Spellami (named Family Practice until 2026-11-15): what's live, how it's run, what's next, and why things are the way they are. `AGENTS.md` covers how the code works; `PRODUCT.md` and `DESIGN.md` cover product truth and the visual system.

**Keep this current.** Any change that ships, any decision made, or any roadmap shift updates this file in the same commit. Write current truth; replace stale lines instead of appending. This repo is public: never put credentials, account IDs, family codes, real children's names, private network addresses or personal infrastructure details here.

Last updated: 2026-11-15

## Live

- Hosted instance: https://spellami.jesklabs.com (listed as "spellami" on jesklabs.com). The former https://spelling.jesklabs.com stays attached to the same Worker as a legacy host: pages 301 (path and query kept), `/mcp` 308, old APIs 410, and its `/sw.js` hands a device's saved Family Code to `/f/<code>` on the new origin, then unregisters.
- Runtime: one Cloudflare Worker (`family-practice`) on the Workers Free plan, with Static Assets, SQLite-backed Durable Objects (`FamilyDatabase` per family, `RegistryLimits`, `TtsCache`, `ShareStore`, `AccountStore`), and Workers AI for speech. Migrations deployed: `v1`–`v4`; hourly notification cron configured.
- Deployed version: `main` at the most recent "deploy" entry in the changelog below. Service worker shell `VERSION` = `v13`.
- Observability: Workers Logs enabled (head sampling 1.0). Aggregate stats at `GET /api/ops/stats` (bearer `OPS_TOKEN`; numbers only).
- The operator runs a weekly automated review (uptime probes, error logs, Workers AI usage against the free tier, family/activity counts, GitHub issues) that reports only when something needs attention.

## Configuration

| Item | Where | Notes |
|---|---|---|
| `SESSION_SECRET` | Worker secret | Signs parent cookies. **Keep stable**; rotating it logs out all parents. |
| `IP_HASH_SALT` | Worker secret | Salts hashed IPs for rate limits. Keep stable. |
| `OPS_TOKEN` | Worker secret (optional) | Enables `/api/ops/stats`; 404 when unset. |
| `ACCOUNTS_SVC` | Worker service binding → `jesklabs-accounts` / `SpellingClient` | Shared Accounts owns Google/email/SSO; stable subject keys app-local links. |
| `FP_SIGNIN_EMAIL`, `FP_SIGNIN_GOOGLE` | Deployer environment | Map to Worker `SIGNIN_EMAIL` / `SIGNIN_GOOGLE`; default `0` (both `0` in production). Enable only once shared Accounts can send Spellami mail / complete Google. |
| `RESEND_API_KEY` | Optional Worker secret (unset in production) | Opt-in notifications only; shared Accounts owns sign-in codes. Quota/verified domain required. |
| `APP_ORIGIN` | Worker var | Canonical HTTPS notification-link/callback origin (`https://spellami.jesklabs.com`); self-hosters must override the hosted default. |
| `LEGACY_HOSTS` | Worker var | Former hostnames that redirect to `APP_ORIGIN` (`spelling.jesklabs.com`); deployer override `FP_LEGACY_HOSTS`, empty disables. |
| `EMAIL_FROM` | Worker var | Default `Spellami <spellami@jesklabs.com>`; self-hosters must configure their verified sender. |
| `TTS_SPEAKER` | Worker var (optional) | Aura-1 speaker; default `asteria`. |
| `CF_API_TOKEN`, `CF_ACCOUNT_ID` | Deployer environment only | Token needs Workers Scripts edit (+ zone Workers Routes/DNS for the custom domain). Never a Worker binding. |
| Custom domains | Workers Custom Domains | `spellami.jesklabs.com` (canonical) and `spelling.jesklabs.com` (legacy), both on this Worker; attached once, `deploy.mjs` does not manage routes. Keep the legacy domain attached: printed codes, class QR codes and installed PWAs point at it. `workers_dev = false`. |

MCP connections need no new secrets, bindings, accounts or registry migration. Their rows and request/write counters live in the existing family DO. Connection tokens survive PIN changes; revoke explicitly.

Free-tier budgets the app enforces itself: voice cache misses 6,000 chars/day global, 1,500/family/day, 2,000/IP/hour; family creation 5/hour/IP plus a global daily cap; unknown-code lookups and PIN failures throttled. Workers AI free allowance is 10,000 neurons/day (Aura-1 ≈ 1,364 neurons per 1k characters).

## Release checklist

1. `node --test` (all green).
2. Local Worker (`cloudflare/deploy.md` → "Local real Worker"), then `node cloudflare/smoke.mjs`, `node cloudflare/ui-smoke.mjs`, for layout changes `node cloudflare/practice-layout-smoke.mjs`, and for `legacy.js`/`sw.js` changes `node cloudflare/legacy-smoke.mjs` (starts its own Worker twice).
3. Bump `VERSION` in `cloudflare/public/sw.js` for any shell change.
4. `node cloudflare/deploy.mjs --dry-run`, then deploy with credentials.
5. Production smoke against the hosted URL (creates and deletes two throwaway families; respects the 5/hour creation limit, so don't loop it). Set `SMOKE_EXPECT_AI=1`.
6. Push `main`, add a changelog line below, and update "Live" if anything structural changed.

## Optional Jesklabs sign-in (deployed, off)

Deployed 2026-11-14 with both `SIGNIN_*` gates `0`: `/api/auth/config` reports `email:false, google:false, sso:false`, every sign-in route returns 404 and the UI hides sign-in. Optional Jesklabs sign-in, shared by Jesklabs apps; it stores your email and which Jesklabs apps you use. No accounts required: Family Code/PIN use is unchanged and child accounts remain prohibited.

Shared Jesklabs Accounts owns Google, email codes and SSO through the `SpellingClient` service binding; this app never sends sign-in mail or talks to Google itself. AccountStore (migration `v4`, unchanged) keeps subject-keyed sessions, family links, preferences and delivery claims; client responses use purpose-bound HMAC refs, never raw subjects. Pending email links are short-lived, HMAC-email-keyed and browser-bound; session and SSO-pending cookies encrypt identity data. Linked accounts provide recovery and opt-in weekly summaries, class updates and review reminders via this Worker's Resend key (notifications only, hourly cron). Deleting sign-in removes this app's link; shared Accounts deletes its user only when no other app links remain. Unlinked lost codes cannot be recovered.

To turn on: redeploy with `FP_SIGNIN_EMAIL=1` and/or `FP_SIGNIN_GOOGLE=1` once shared Accounts can deliver Spellami codes / complete Google. Real email delivery, Google, SSO across apps and physical iOS behavior are unverified until then.

## Roadmap

**Done**
- Optional parent sign-in delegated to shared Jesklabs Accounts: subject-keyed links, SSO-first entry with explicit confirmation, opt-in notifications (deployed 2026-11-14, gated off).
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

## Decisions

Newest first. Each entry gives what was decided and why; if a decision is reversed, edit the entry and say what replaced it.

- **2026-11-15: The app is Spellami, at spellami.jesklabs.com.** Spell + French *ami*: a spelling friend. Replaces "Family Practice", which never matched the "spelling" listing, and "Spellwell", an existing trademarked spelling curriculum; no app or trademark uses Spellami. Internal identifiers (Worker `family-practice`, storage keys, the Accounts client id `spelling`) keep their names because renaming them would orphan family data or change account subjects. The old hostname stays on the same Worker rather than a separate redirect Worker, so there is no route-swap gap, and it hands each device's saved Family Code to the new origin's existing `/f/<code>` join page instead of making families retype it. Sender moves to `spellami@jesklabs.com` (nothing was verified for the old address yet).

- **2026-11-15: App icon is the "Letter tile".** A letter tile plus sound waves says "hear it, spell it" and stays readable at 32px. The letter is the app's own Practice Reader Bold single-storey "a" (the form early readers see in practice), not the double-storey "a" of the concept mockup. The icon carries no name.
- **2026-11-14: Shared Jesklabs Accounts, not per-app identity providers.** Accounts owns Google, email-code authentication and shared SSO; Spellami owns subject-keyed sessions, family links and opt-in notifications. SSO always asks explicit confirmation with a masked account before creating a local session; a different-account action clears pending state. No accounts required, no child identity, no Family Codes in auth redirect URLs. Resend here is notifications-only, all sign-in flags default off, and local deletion removes this app link (and the shared account if it has no other app links). This supersedes the per-app provider setup in the earlier optional identity decision.
- **2026-11-14: MCP links never embed a reversible family identifier.** Bare SHA-256 of the ~46-bit Family Code permits offline guessing. New fpc2 links encrypt/authenticate routing with AES-GCM under a purpose-derived SESSION_SECRET key; old fp links are retired, not grandfathered. Parent lists retired links for revocation/replacement. Account response family references and PIN cookie bindings use purpose-bound HMAC; stable secrets remain required.
- **2026-11-14: Optional parent identity, never kid accounts.** Google and emailed-code sign-in may link existing families and recover linked codes. Code/PIN-only access remains supported. Verified parent email is allowed only for account features and opt-in summaries/notifications; unlinked lost codes still have no recovery. This supersedes the earlier blanket no-email/no-login decision.
- **2026-11-14: Share links, not a public library.** Owner-approved bearer links carry immutable spelling snapshots with sentences and an optional parent-selected verse; never identity or progress. Links never expire unless the owner stops them. Imported copies remain independent.
- **2026-11-14: Single-admin class lists are publishing feeds.** One creating family can append immutable weeks; other families choose which kids receive copies. No school accounts, rosters, search, multi-admin editing, or remote changes to imported copies. This narrowly replaces the earlier blanket “no teacher/class mode” decision, without expanding into classroom management.

- **2026-11-14: Suppress accidental zoom on the child practice desk.** Viewport scaling limits, manipulation touch behavior, iOS pinch guards and ≥16px form controls prevent zoom from disrupting practice. Single-finger scrolling and rem-based OS text sizing remain; pinch magnification is intentionally restricted (accessibility trade-off documented in DESIGN.md).
- **2026-11-14: Parent tools live on a separate page, not in kid tabs.** Wrapping section controls keep every tool reachable on a phone; sheets scroll independently of their visible action footer.
- **2026-11-14: MCP uses per-family scoped connection tokens, not accounts/OAuth.** Only token hashes are stored; an authenticated encrypted route (superseding the unsafe bare family hash) routes without scanning. Uses the legacy initialize lifecycle (`2025-11-25`); the current `2026-07-28` protocol removes that handshake and is not advertised. No delete tools, aggregate progress only, 60 requests/min/token and 20 writes/hour/family. PIN changes deliberately keep assistant access until explicitly revoked.
- **2026-11-14: Learn has no intro screen; the stage tabs are the navigation.** Tap any stage to jump to it; a forward jump is recorded as a skip and never credits learning. *Why:* parent testing found the intro page redundant and a separate "Skip to recall" button duplicative once the tabs work.
- **2026-11-14: Learn stages scale with word length and never demote.** 1–3 letters get 2 stages, 4–5 get 3 and 6+ get 4. A miss shows the word, then retries the same stage. A first-try Fade jumps to Recall. *Why:* parent testing found the fixed 4–5 steps drawn-out and step-backs punitive.
- **2026-11-14: Spaced repetition uses Leitner boxes (1/2/4/7/14/30 days), not FSRS.** *Why:* weekly spelling lists are small, and "this word is in box 2" is explainable to kids and parents. It is deterministic, cheap to compute in each family DO, and backfilled from history. FSRS suits large card decks.
- **2026-11-14: Learn mode uses Copy–Cover–Compare and vanishing cues (fading letters).** *Why:* both are evidence-based spelling methods. Learn attempts are tracked separately so test accuracy stays honest.
- **2026-11-14: Custom on-screen keyboard, key sound and haptics on touch devices, on by default.** This follows the approach in the author's Incord app. *Why:* the custom keyboard keeps OS autocorrect from interfering with spelling, and kids respond to tactile feedback. Each device can turn these off.
- **2026-11-14: Visual system from an impeccable design pass** (`PRODUCT.md`, `DESIGN.md`). *Why:* it replaced a generic-AI look with focused practice screens for kids.
- **2026-11-14: Open-sourced under MIT with fresh history.** *Why:* trust for parents and contributions. Earlier history contained personal details, so it was not published.
- **2026-11-14: Installable PWA**; the shell is cached and family data stays online-only. *Why:* families use phones and tablets, and no family data should sit in shared caches.
- **2026-11-13: Voice is Workers AI Deepgram Aura-1 with a two-tier cache.** *Why:* browser speech is poor or missing on Linux Chromium. MeloTTS is deprecated on 2026-11-20. The shared cache keeps the per-character pricing within the free tier.
- **2026-11-13: Public, Family Code plus per-family Parent PIN, child first names only.** Optional parent sign-in was added 2026-11-14; code/PIN-only use remains supported. *Why:* zero setup friction and no identity data to protect. Lost code means lost data, which is mitigated by printable codes and exports. An earlier Google-login gate was removed.
- **2026-11-13: Parents run it for their own kids, not school accounts.** Approved single-admin class-list feeds (2026-11-14) let families exchange practice material without rosters or school-managed student data.
- **2026-11-13: Cloudflare Workers Free instead of a VPS or Vercel.** *Why:* the free tier with built-in SQLite DOs and AI, and a public kids' app shouldn't share a host with private services.
- **2026-11-13: Parents paste verse text; no Bible API.** *Why:* translation licensing. Samples use public-domain KJV.
- **2026-11-13: Zero npm runtime dependencies, vanilla JS, no build step.** *Why:* small, auditable, easy for agents and self-hosters.

## Changelog — shipped 2026-11-14 in `b459cab` (shell v11; migration v4 + hourly cron applied; prod smoke 53 requests / 64 assertions; retired `fp_` links return 401 with guidance)

- `signin` review fixes, shell v10: removed native-append null text; split identity settings into Your sign-in / Parents linked to this family / Email reminders; equal-width action rows; recovery retained on landing and added to Family with hyphen-only code breaks. Parent tools now have Kids · Lists · Verses · Family plus a collapsible More group. Toasts reserve bottom safe-area space and keep Save clear. All four email types share a cobalt, system-font, inline-styled table layout; weekly summaries now include actual practice days. Eight HTML/text golden fixtures cover weekly, class update, review nudge and sign-in code emails.

- `signin` security, shell v11: encrypted/authenticated fpc2 MCP routing, unconditional legacy-link retirement and revocable retired-row UI; HMAC public account family references and PIN-cookie binding. No bare family routing hash in client responses. Existing links must be recreated after deployment; existing PIN cookies require unlock again. Sol identifier audit and Opus crypto review approved with no blockers. New regression checks cover IV/ciphertext/tag rejection before family dispatch, route swapping, legacy retirement, migration/revocation and no bare family-hash responses/cookies; browser retirement/revocation passes at three viewports.
- `signin`: optional parent identities and code recovery; Family Code/PIN-only access unchanged. Singleton AccountStore v4, Google state/PKCE flow, hashed emailed codes, masked family links, opt-in Sunday 5pm weekly summaries, Tuesday/Friday review nudges and hourly batched class updates, signed one-click unsubscribe, numeric mail counters and a 500/day reservation cap. Google/Resend live delivery and production cron are unverified; no production changes made.
- Verification: 151 unit tests (including eight email golden fixtures), uploader zero-network dry-run, local email-sink recovery smoke (76 checks), core API smoke (53 requests/65 assertions), desktop/mobile UI and parent/practice/sharing layout smokes pass. Sign-in UI smoke passes 193 assertions at desktop and 390×844, saves 44 screenshots plus eight email HTML samples, and reports zero console/CSP/third-party-request errors. Class publication API smoke also passes all 58 assertions, including the real ten-minute publish throttle. Independent auth review findings were fixed with regressions (pending-link revocation, safe Lock, auth lookup throttles, full multi-family digests).

## Changelog (deploys)

- 2026-11-15 app icon (`19b265c`), shell v13: "Letter tile" icon (white letter tile with a cobalt Practice Reader "a" and two marigold sound arcs on cobalt) replaces the seed-packet block. Hand-built SVG sources; separate `any` (rounded, transparent corners) and full-bleed `maskable` PNGs at 192/512, opaque 180px iOS touch icon, SVG favicon. Checked legible at 32px. Local: 162/162 tests, API smoke 65 assertions / 53 requests, UI 2 journeys (manifest + icons fetched, SW activated). Live: all six icon assets 200 and byte-identical, shell v13 served, sign-in gates still off, prod smoke 64 assertions / 53 requests passed.
- 2026-11-14 Jesklabs Accounts cutover (`972a419`), shell v12: optional parent sign-in now delegates Google, email codes and SSO to shared Jesklabs Accounts (`SpellingClient` binding); app-owned codes, Google OAuth and the sign-in email template removed. SSO-first entry with explicit masked-account confirm/decline, POST-based Google start without Family Codes in URLs, immediate email attach redirect, app-only vs. all-Jesklabs sign-out, subject-keyed links and unsubscribe tokens, numeric `accounts` ops stats. Both gates off in production. Local: 162/162 tests, API smoke 65 assertions / 53 requests, UI 2 journeys, sign-in API 91 checks, sign-in UI 213 assertions / 54 screenshots at desktop and 390×844, parent layouts at three viewports; Opus review of Sol's build found no blockers. Live checks: config all false, sign-in routes 404, ops `accounts.service=ok` (binding probe), shell v12 served, static pages 200. Prod smoke after cutover: 64 assertions / 53 requests passed.
- 2026-11-14 sharing: share links (`/s/…`) and single-admin class lists (`/c/…`) with QR, follows and new-week cards, multi-kid imports with optional verse, MCP `get_shared_list`/`import_shared_list`, reports; ShareStore migration v3 applied; shell v8. Live checks: unknown share/class → 404, share pages `noindex`; core prod smoke passed (53 requests / 64 assertions). Sharing smoke against prod passed (58 assertions, including the real ten-minute publish interval). Smokes no longer send `CF-Connecting-IP` to non-localhost targets (Cloudflare rejects it).
- 2026-11-14 `696881b`: separate Parent page (kid view keeps 3 tabs); mobile parent sheets with pinned Save/Cancel and bounded textarea; MCP connector (per-family bearer connection links, add/read or read-only, 7 tools, revoke; protocol 2025-11-25); pinch/double-tap/auto-zoom and overscroll disabled; invocation URL logging off. Live checks: bogus token → 401, foreign Origin → 403, GET → 405; full prod smoke passed (53 HTTP requests, 64 assertions, including live MCP tools/scopes/revocation).
- 2026-11-14 `5116a93`: Learn starts straight from the list (intro page removed); stage tabs are tappable to jump between stages (forward jumps logged as skips); bottom "Skip to recall" removed.
- 2026-11-14 `c6d0989`: Learn stages by length, no demotion, fast-track, skip to recall / start test; Leitner Review + word bank; safe-area practice band; kid-facing voice status removed; smoke cleans up in `finally`.
- 2026-11-14 `fd730f7`: impeccable redesign, on-screen keyboard, key sound + haptics (default on).
- 2026-11-14: PWA, mobile pass, Learn mode, ops stats, Workers Logs on; repo made public.
- 2026-11-13: Aura-1 cloud voice + `TtsCache` (migration v2).
- 2026-11-13: first public multi-family deploy.
