# Spellami ☀

A free, open-source spelling and Bible-verse practice app, built by a parent for his own kids and open to any family.

**[Try the hosted instance](https://spellami.jesklabs.com)** · [Deployment guide](cloudflare/deploy.md) · [Security](SECURITY.md)

- **Spelling:** hear a word and sentence, learn it with progressively fading letter clues, then take a test. Includes printable lists, retries, and tricky-word review.
- **Verses:** parent-provided wording, read/listen, progressive blanks, first letters, memory typing, and reference quizzes. Samples use public-domain KJV.
- **Progress:** first-try test accuracy, separate Learn history, verse mastery, and practice streaks.
- **Sharing (Cloudflare):** share an immutable spelling list with sentences and an optional verse, or publish a single-admin class feed. Families import independent copies; no public library or search.
- **Phones:** install the Cloudflare build on your home screen; app shell loads offline, but family data and saving require internet.

- Project status, roadmap and decisions: [STATUS.md](STATUS.md)

## Privacy

No ads, analytics or trackers. No accounts required. Optional Jesklabs sign-in, shared by Jesklabs apps; it stores your email and which Jesklabs apps you use. Google or emailed-code sign-in is available through this shared service in the Cloudflare build; kids never need accounts. Use first names or nicknames only. A Family Code opens a family's practice; its Parent PIN protects editing and backups. Save both. A signed-in parent can link families for recovery; without a linked parent account, a lost code cannot be recovered. Parents can export or delete their data, manage linked parents, and delete their account. Optional weekly summaries, class-list notices and review reminders are off until chosen; unsubscribe stops these emails, not requested sign-in codes. Parent email is used only for account features and opted-in notifications, not shared with other families. Normal sign-out affects only this app. A separate option ends shared Jesklabs sign-in on this device. Deleting this app’s sign-in removes its shared Accounts link; the shared user remains while other app links exist.

Optional share links expose only the selected list title/date, note, words and sentences, plus a selected verse. Class feeds expose their name and published weeks. Never put private details in those fields. Anyone with the link can view or copy it until its owner stops sharing; imported copies remain independent. Profiles, family codes and progress are not included.

Cloud voice sends only spoken text to Cloudflare Workers AI, with device speech as an alternative/fallback. Public shell assets are cached on the device; family API data and answers are not stored in the offline cache. Already-heard audio has a bounded, volatile memory cache. Hosting request logs may contain normal technical information. Optional operator statistics contain aggregates only.

## Self-host: Cloudflare (multi-family)

Requires Node.js 24+, a Cloudflare account, Workers Static Assets, SQLite-backed Durable Objects, and Workers AI. No npm runtime dependencies or build step.

```sh
npm run check
node cloudflare/deploy.mjs --dry-run  # no network calls
```

Set `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `SESSION_SECRET` and `IP_HASH_SALT` (secrets at least 32 characters). Keep both secrets stable. Optional `OPS_TOKEN` enables private aggregate stats; optional `RESEND_API_KEY` delivers opted-in notifications only.

Tune operational values in `cloudflare/settings.json` (validated against `cloudflare/settings.js` on deploy and Worker load). Copy `cloudflare/instances/jesklabs.json` to your own named profile and change `appOrigin`, `emailFrom`, `legacyHosts`, `accounts` and `signin`. Omit `accounts` and set both sign-in switches false for code/PIN-only hosting. The sender must be verified with Resend. Without a profile, identity is neutral: no legacy hosts, no Accounts service, no sign-in and no notification sender. Supply your canonical HTTPS `APP_ORIGIN` in the environment for a profile-free deployment; dry-run alone may use a placeholder.

Hosted-instance production command (with secrets in the environment):

```sh
node cloudflare/deploy.mjs --instance jesklabs --dry-run
node cloudflare/deploy.mjs --instance jesklabs
```

Use `--instance your-profile` for your own deployment (`--instance=your-profile` also works). Settings changes take effect after redeploy; invalid settings abort before any network call, leaving the last good deployment running. The Worker falls back to defaults and logs once if its SETTINGS binding is missing or invalid.

The uploader adds the `ACCOUNTS` / `AccountStore` binding using additive migration v4 and configures hourly cron (`0 * * * *`); it does not configure DNS or hostnames. The shared Accounts service owns Google and email-code authentication; Spellami keeps app-local family links keyed by the stable Accounts subject. Register this app’s exact callback with Accounts (see deployment guide). Notification Resend is optional, subject to its own quotas and configuration; no provider is contacted by dry-run/tests. See [the deployment guide](cloudflare/deploy.md) for token scopes, hostname setup, local Wrangler smoke tests, migrations, and free-tier speech quotas. See [PWA notes](cloudflare/PWA.md) for install/cache behavior and release versioning.

## Retired LAN build

Spellami now has one build: the Cloudflare Worker. The unsupported single-family
Node/Docker LAN build was retired on 2026-11-16; its final source is preserved at
`lan-build-final`. Do not use that historical version for a public deployment.

## Backups and contributing

Parent mode exports JSON/CSV and restores JSON transactionally. Import replaces current practice data, so export first. Keep codes/backups private.

Bug reports and pull requests are welcome. Read [AGENTS.md](AGENTS.md), use fictional fixtures, preserve the Worker build, and run `npm run check`. Development and optional Chromium smoke checks are documented in [cloudflare/deploy.md](cloudflare/deploy.md). Report vulnerabilities through [GitHub private vulnerability reporting](SECURITY.md).

[MIT](LICENSE) · Copyright (c) 2026 Eric Jung.

## Connect an AI assistant

In the hosted Worker build, open **Parent mode**, unlock with your PIN, then choose **Connect an AI assistant**. Create a named connection with **Add & read** (default) or **Read only** access. Save its connection URL immediately: it is shown only once. Up to five connections can be active.

- **Claude:** Settings → Connectors → Add custom connector → paste the URL.
- **Claude Code:** `claude mcp add --transport http spellami <url>`
- **Other clients:** use any MCP client supporting Streamable HTTP. The URL is `https://<your-origin>/mcp/t/<token>`. Header-capable clients can instead use `https://<your-origin>/mcp` with `Authorization: Bearer <token>`.

Anyone with this link can add and read your family's lists. Revoke it if shared by mistake. Read-only connections cannot change content. Parent PIN changes do **not** revoke connections; use **Revoke** or **Revoke all**. Deleting the family removes all connections.

The seven tools list kids/lists, read a list, add/update a spelling list, add a parent-provided verse and read aggregate progress. Ask the assistant for kid-friendly example sentences; missing sentences stay blank. Supply your family's own verse translation text rather than asking it to invent scripture (public-domain KJV/WEB is fine). No delete tools exist. The server stores only token hashes, uses no accounts or OAuth, and supports the stateless legacy initialize lifecycle with MCP `2025-11-25` (with `2025-06-18` and `2025-03-26` negotiation). Limits are 60 requests/minute/connection, 20 writes/hour/family, and 256 KiB/request.
