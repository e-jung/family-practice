# Family Practice — public multi-family Worker

The public build lives in `cloudflare/` and `cloudflare/public/`. The independent
single-family Node/Docker LAN build (`server.js`, `public/`) remains working and
covered by the same `node --test` suite; it is not the public deployment.

## Product and privacy

Anyone can create an empty family space with an optional display name and a
4–8 digit Parent PIN. No email, password, login provider, analytics, ads, fonts,
CDNs, or third-party browser requests. Speech defaults to Cloudflare Workers AI
(Aura-1 asteria), with a device `speechSynthesis` option and automatic fallback. Only
text read aloud is sent for synthesis, not profile names or typed answers.
Use first names or nicknames, not full names.

The generated Family Code is the only way back in: save, copy, or print the card.
Codes cannot be recovered by email. The browser saves the code in localStorage;
Switch family removes the local code and locks Parent mode. A `/f/<code>` link
pre-fills joining and grants kid-level access to whoever has it. Do not publish
these links. Request paths containing a shared code can appear in normal host
access logs; the Durable Object name itself never contains the raw code.

The Family Code grants access to kids, practice material and progress; parent
edits/exports/imports require the PIN. Parent sessions last 12 hours. PIN change
requires the current PIN and invalidates previously issued sessions. Deleting a
family requires an unlocked parent session, the PIN again, and the exact family
name or code; it removes stored content/history/credentials. Backups contain
practice data, not the Family Code or PIN credentials. Import replaces practice
data only, preserving the destination family's PIN and identity.

## Storage and security

- One SQLite-backed `FamilyDatabase` Durable Object per family, named
  `fam:` + SHA-256(normalized Family Code), never the raw code. A lookup can
  instantiate an empty DO/schema but **never creates a family row**: unknown or
  deleted codes return 404. Only `POST /api/families` can create one.
- Family Codes use three independent choices from 2,048 curated kid-safe
  compound words (16 nature/color prefixes × 128 nouns), then four digits:
  **46.28 bits entropy**, using `crypto.getRandomValues`, unbiased suffix rejection.
- PINs: PBKDF2-SHA256, 100,000 iterations, unique per-family salt. Ten failures
  per family per 15 minutes, including PIN changes/deletion. Limits persist in SQL.
- HMAC-signed `HttpOnly; Secure; SameSite=Lax` parent cookie, 12 hours, bound to
  the family hash and its session epoch (rotated when PIN changes).
- `RegistryLimits`, named `registry`, stores only salted IP hashes, counts and
  expiry: five creation requests/hour/IP, 200/day global cap; 30 failed family
  lookups/IP/15 minutes. Creation requests count even if validation fails. Expired
  buckets are removed on registry requests. No raw IPs are persisted by the app.
- All family API calls send `X-Family-Code`. Internal routing headers are
  overwritten by the Worker and the internal create route is not public.
- Max 10 kids, 200 lists, 100 current words/list, 300 verses, 2,000 chars/verse;
  256 KiB JSON requests, 2 MiB imports. Attempts and verse attempts together
  retain the newest 50,000 rows. At most 100 additional sessions without retained
  attempts are kept (attempt-backed sessions are bounded by the attempt cap).
  Imported content uses the same field-length limits as editing. Edited word
  versions remain for history.
- POSTs reject foreign Origins and require JSON. DOM content is built with text
  nodes, not user-controlled HTML. All responses have nosniff and no-referrer;
  HTML has self-only CSP, no inline scripts, `frame-ancestors 'none'`.

## Private-by-link sharing

The `SHARES` binding is a singleton SQLite `ShareStore` named `shares`. It stores immutable one-off snapshots, single-admin classes with up to 200 immutable published weeks, aggregate counters and reports. It receives HMAC-derived ownership bindings, never family codes or kid identifiers. The follower family stores its own selected kids and import markers. Class follows poll the latest published week with a ten-minute family-side cache.

A public `/s/<slug>` or `/c/<slug>` is an unlisted bearer link with no expiry until the owner stops it. No public catalogue, search, accounts or rosters are provided. Public snapshots include only title/date/note, words with sentences and an optional verse (reference/text/translation). Public pages and APIs are `noindex`; user data is rendered as text. Parents must not put private information into shared content. Imported copies belong to the receiving family and do not change when the source is edited or stopped.

Parents create/stop links, manage classes, publish weeks and choose import recipients after PIN unlock. Existing per-family content limits apply transactionally to multi-kid imports; duplicate verses (same reference and text) are skipped. Single-admin classes are limited to five active feeds and one publication per ten minutes. Registry quotas are 20 share/class creations/day/family, 60 imports/hour/IP and 120 public reads/minute/IP (salted hashes only). Reports accept optional reasons of at most 300 characters. Ops statistics include aggregate share/class/import/report counts, never content or ownership identifiers.

Additive migration `v3` creates `ShareStore`. A live `v2` deployment must send `{old_tag:"v2",new_tag:"v3",steps:[{new_sqlite_classes:["ShareStore"]}]}`; a first deployment sends the full v1+v2+v3 chain. Preserve existing migration history and secrets. The raw deployer handles both paths; dry-run and mocked-fetch tests require no Cloudflare API access.

Local sharing checks: `node cloudflare/sharing-smoke.mjs` runs the real ten-minute publication interval; `node cloudflare/sharing-ui-smoke.mjs <screenshot-directory>` checks desktop and phone sharing journeys. Use fresh disposable state to avoid inherited family-creation quotas.

## Cloud voice

`GET /api/tts?text=hello&lang=en` requires an existing `X-Family-Code` (kid access;
no Parent PIN). Text is trimmed, nonempty, at most 300 UTF-16 code units; only
English is accepted. Existing unknown-code/IP throttles also apply. No raw code
or IP is stored in speech cache keys.

The [Aura-1 model documentation](https://developers.cloudflare.com/workers-ai/models/aura-1/)
defines `AI.run('@cf/deepgram/aura-1', {text, speaker: 'asteria', encoding: 'mp3'})`.
Override the default with the `TTS_SPEAKER` environment variable/constant. Aura returns
a ReadableStream of MPEG audio (or a Response with `returnRawResponse: true`). The
adapter also accepts ArrayBuffer/typed arrays and base64 JSON defensively. Before
caching, bytes must begin with ID3 or MPEG frame sync and be ≤512 KB. MeloTTS was
replaced because Cloudflare deprecates it on **2026-11-20**.

Lookup order: `caches.default` → shared SQLite **TtsCache** DO instance
`idFromName("tts-cache")` → synthesis, then write both caches. Edge keys are
`https://tts-cache.internal/v2/<sha256(model|speaker|mp3|lang|text)>`; they are never
outgoing requests. The DO stores `key, audio BLOB, bytes, created, last_used` and
evicts least-recently-used clips above **400 MB (400 MiB)**. Edge cache is local and
evictable; durable clips are shared across datacenters and survive edge eviction.
Family validation happens before either lookup. In-isolate same-clip requests
share inference; simultaneous misses across isolates may still synthesize twice.
Cache failures are best-effort and do not disable synthesis.

Aura-1 costs **1,363.64 neurons per 1,000 characters**: the 10,000-neuron daily free
allowance covers approximately 7,300 characters. RegistryLimits reserves cache-miss
characters before inference: **6,000 globally per UTC day, 1,500 per family per UTC
day, 2,000 per hashed IP per hour** (hour window starts at first reservation).
Failures count; cache hits do not. Global/family buckets expire at UTC midnight.
These ceilings leave headroom but are not a guarantee against account-wide usage.
Quota returns 429 `voice_quota`; missing AI binding, invalid audio, model error or
3.5-second synthesis deadline returns 503 `voice_unavailable`.

The browser uses at most 24 in-memory blob URLs and a 4-second download timeout,
then device speech on failures. MP3 playback stays under `media-src 'self' blob:`;
no third-party media origin is needed. Practice warms only the current/next words
and their sentences, not entire lists. Voice engine and speed are family settings.

For **strictly offline** Miniflare tests, copy `wrangler.toml` into an ignored
local config and omit `[ai]`: AI bindings are remote-only, even with `--local`.
Preserve `send_metrics = false`, set `WRANGLER_SEND_METRICS=false`, and adjust
`main`/asset paths relative to the local config. The HTTP smoke now asserts the
missing-AI 503 response. Never invoke real inference from a local smoke.

## Offline review (no credentials or network)

Requires Node.js 24+. From the repository root:

```sh
node --test
node --check cloudflare/deploy.mjs
node cloudflare/deploy.mjs --dry-run
```

The zero-dependency uploader uses Node built-ins only. Dry-run performs **zero
network calls**, prints modules/assets/migrations/secret names, and writes no
files. Importing it does not deploy. `buildPlan`, `metadataFor`, and `deploy` are
exported for mocked-fetch tests.

## Local real Worker / Miniflare

```sh
mkdir -p .tools
node --input-type=module - <<'JS'
import {readFileSync, writeFileSync} from 'node:fs';
const config = readFileSync('cloudflare/wrangler.toml', 'utf8')
  .replace('[ai]\nbinding = "AI"\n\n', '')
  .replace('main = "worker.js"', 'main = "../cloudflare/worker.js"')
  .replace('directory = "public"', 'directory = "../cloudflare/public"');
writeFileSync('.tools/voice-local.toml', config);
JS
WRANGLER_SEND_METRICS=false npx -y wrangler@4.161.0 dev \
  --config .tools/voice-local.toml --local --port 8792 \
  --persist-to /tmp/family-practice-disposable \
  --var SESSION_SECRET:local-test-secret-32-characters-long \
  --var IP_HASH_SALT:local-ip-hash-salt-32-characters-long
```

In another terminal:

```sh
node cloudflare/smoke.mjs
```

Optional headless browser verification uses Playwright as a **tool only**, not an
application dependency. Install Playwright/Chromium in a disposable tooling
folder, then run `node cloudflare/ui-smoke.mjs` with `PLAYWRIGHT_MODULE` pointing
to its absolute `playwright/index.mjs`. Set `CHROMIUM_PATH` only when using an
already-installed alternate Chromium. Run from the project root (screenshots
are written under ignored `.tools/`). It creates/deletes two more families, so
use fresh local storage if the creation cap has already been exercised.

The smoke script refuses non-localhost URLs and creates/deletes two disposable
families, checking practice, export/import, and cross-family parent isolation.
It uses `SMOKE_URL` if supplied. If your shell injects a global network proxy,
unset HTTP_PROXY/HTTPS_PROXY/ALL_PROXY (and lowercase forms) for the smoke process.
Use a fresh `--persist-to` directory when repeating creation tests: limits are
intentionally durable. `.dev.vars`, `.wrangler/`, and local data are gitignored.

## Deploy — only when explicitly authorized

No deployment or Cloudflare account API calls are needed to prepare/test this
build. Before a future authorized deployment, provide:

| Environment variable | Purpose |
| --- | --- |
| `CF_ACCOUNT_ID` | Intended Cloudflare account's 32-hex ID |
| `CF_API_TOKEN` | Account-restricted Workers Scripts Edit permission |
| `SESSION_SECRET` | Stable random secret, at least 32 characters |
| `IP_HASH_SALT` | Independent stable random secret, at least 32 characters |
| `OPS_TOKEN` | Optional independent bearer secret for aggregate operator stats |

**`PARENT_PIN` is not used or required.** Each parent chooses their own PIN.
Generate the two secrets locally (e.g. 32 random bytes encoded as hex), save them
in your password manager, and reuse on subsequent deploys. Changing
SESSION_SECRET invalidates sessions; changing IP_HASH_SALT resets IP buckets.
The script does not read `.env` or persist credentials and never logs secrets.

When deployment is authorized, run `node cloudflare/deploy.mjs` with those four
variables already set securely. This immediately uploads/deploys the Worker and
assets, then writes **SESSION_SECRET and IP_HASH_SALT**, plus **OPS_TOKEN only when supplied**, as Worker secrets. Omitting OPS_TOKEN logs a warning and preserves any existing deployed token; a fresh deployment without it has no ops endpoint.
It does not provision subscriptions, routes, DNS, custom hostnames, workers.dev,
preview URLs, or Access policies. For this public product **Cloudflare Access is
not required and must not gate the app**; independently enable/configure the
intended public hostname. `workers_dev=false` / `preview_urls=false` in Wrangler
are deliberate defaults, not proof of any live public address.

## Uploader details

- Worker `family-practice`, compatibility date `2026-11-01`.
- ES modules `cloudflare/worker.js`, `cloudflare/core.js`, `cloudflare/auth.js`,
  `cloudflare/tts.js`, `lib/practice.js`, preserving relative imports without bundling/rewriting.
- Bindings FAMILY → FamilyDatabase, REGISTRY → RegistryLimits, TTS_CACHE → TtsCache,
  ASSETS → assets, AI → Workers AI (`type: "ai"`).
- Preserve initial migration `v1`, `new_sqlite_classes: ["FamilyDatabase", "RegistryLimits"]`.
  New migration `v2` adds `new_sqlite_classes: ["TtsCache"]`. Existing live v1 sends
  `{old_tag:"v1",new_tag:"v2",steps:[{new_sqlite_classes:["TtsCache"]}]}`.
  First deployment sends `old_tag:""`, `new_tag:"v2"`, with separate v1 and v2 steps.
- Every regular file in `cloudflare/public/` is uploaded; symlinks are refused.
  `_headers` / `_redirects` are asset configuration, not downloadable assets.
  All asset requests run through the Worker so security headers and `/f/` work.
- Manifest uses SHA-256 of base64 contents plus extension, truncated to 32 hex.
  Asset upload session includes the complete manifest, even cached assets.
- API sequence: read `/workers/scripts/family-practice/settings` (script-list
  fallback for omitted migration tag/404); create assets-upload-session; upload
  returned buckets to `/workers/assets/upload?base64=true` using the **asset
  session JWT**, not the API token; PUT script multipart metadata/modules with
  completion JWT; PUT two required secrets and optional OPS_TOKEN. Existing `v1` applies only v2; existing `v2` omits migration metadata;
  unknown tags abort. `keep_bindings: ["secret_text"]` preserves other secrets.
- Secret writes and script upload are not atomic. A failure can leave an earlier
  step live; rerun with the same stable secrets after correcting the cause.
  The app returns 503 until both secrets are configured. Non-secret bindings are
  owned by the uploader, not arbitrary dashboard additions.

Free quotas are account-wide: Workers 100k requests/day and CPU limits; SQLite
DO requests/duration/storage limits also apply. Public traffic runs through the
Worker/registry and family DO, so static-only allowances are not a capacity
promise. The uploader never buys a plan. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
and [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Verification record

Prepared 2026-11-13: **46 tests passed, zero failures** (34 Worker/deployer/AI
route tests, 12 retained Node/grading/Piper TTS tests). The 13 AI tests cover
Aura input/output shapes, MP3 signatures, authenticated two-tier cache sharing,
character quota boundaries/expiry, durable LRU eviction/replacement/clip limits,
cache outages, concurrent dedupe and the 3.5-second model deadline. Mocked deploy
tests verify first-deploy v1+v2, live v1→v2, v2 no-op and unknown-tag rejection.
Offline deployment dry-run includes AI/TTS_CACHE and both migration plans, with
zero network requests.

Real Wrangler 4.161.0 / Miniflare SQLite, with AI omitted from an ignored local
config: **33 HTTP requests, 30 assertions**, including 503 voice fallback,
creation/practice/import/export/isolation/deletion. Both `send_metrics = false`
and `WRANGLER_SEND_METRICS=false` were applied. No real inference was invoked.

Chromium journeys at **1440×1000 and 390×844** pass onboarding → kid/list →
spelling → verse → progress → switch/join/privacy, with zero unexpected
console/page errors, third-party requests or checked horizontal overflow.
Mocked valid MP3 audio is genuinely decoded/played under the unchanged blob
media CSP. Mocked 503 and 4-second timeout fall back to instrumented browser
speech. Checks cover device choice, blob reuse, bounded word/sentence prefetch,
single-request letter spelling, pitch preservation, and navigation cancellation.
The two journeys made 8 successful cloud mocks and 4 mocked 503 requests. Browser fallback
was instrumented, not human-auditioned. Screenshots remain ignored under `.tools/`.

Production AI output, audible voice quality, and real-device playback remain
unverified. Nothing was deployed; no Cloudflare account API was called.

## Private operator statistics

`GET /api/ops/stats` requires `Authorization: Bearer <OPS_TOKEN>`; comparison
hashes both values and compares fixed-length digests without early exit. Unset
OPS_TOKEN (and non-GET methods) return 404; incorrect authorization returns 401.
The route does not require a family code or parent session. All responses are
`Cache-Control: no-store`. Keep this secret separate from family PINs and never
put it in browser assets, query strings, logs, or shared links.

Response contract: `asOf`, `coverage`, `families: {total,created7,created30,active7}`,
`attempts7: {test,learn,verse}`, `pinLockouts7`, and `ttsDaily` (exactly seven UTC dates, zero-filled,
newest first: `day,synthesized_characters,cache_hits,quota_429`). Test includes
ordinary spelling and tricky-word attempts. A PIN lockout is counted when the
tenth failed PIN triggers a lockout, not each subsequent rejected request.
Successful synthesis counts characters; reservations still charge failed AI
calls to the independent abuse quotas. Cache hits include edge and durable hits.
Active families have at least one spelling, Learn, or verse attempt (opening a profile does not count).
Attempts/active/lockouts use the current UTC date plus six preceding dates;
creation windows use rolling 7/30 days.

Families report only their hash, existence, creation timestamp, active UTC date,
and daily numeric counters to the existing registry on mutations and their first
read each UTC day. Stats query registry SQL only; no family fanout. Registry rows
contain no names, codes, PINs, word/verse text, answers, or raw IPs; the response
contains no identifiers. Family deletion removes its registry membership but
retains recent numeric counts. Daily counters expire after 30 days. No external
analytics service, tracking identifier, client analytics, or third-party browser
request is introduced.

Coverage starts when this reporting is enabled. Previously created families are
registered lazily when next visited; their creation date is unknown and excluded
from created7/30. Dormant older families cannot be enumerated from a DO namespace.
Reports are idempotent snapshots and best effort so registry outages cannot block
practice; a later mutation/first daily read repairs missed snapshots. They are
operational estimates, not billing/audit records. Data imported from backups does
not generate new attempt events or backdate operational creation counters.

Learn backend: create a session with `kind: "learn"`; send `/api/attempts` with
`mode: "learn"` and `step` (or frontend alias `level`) in `0,25,50,75,100`.
Stored fields are `mode` and integer `step`. Ordinary attempts default to
`mode: "test", step: 0`. Mode must match the session. Learn permits repeated
copies/backtracking and requires one correct step-100 attempt per intended word
before session completion. Learn attempts remain visible in parent attempt history but are excluded from accuracy, tricky
words and completed-test-list counts; they count toward practice streaks. Old backups default absent mode/
step to test/0; invalid imported mode/step values are rejected.
