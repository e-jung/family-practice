# Family Practice ☀

A free, open-source spelling and Bible-verse practice app, built by a parent for his own kids and open to any family.

**[Try the hosted instance](https://spelling.jesklabs.com)** · [Deployment guide](cloudflare/deploy.md) · [Security](SECURITY.md)

- **Spelling:** hear a word and sentence, learn it with progressively fading letter clues, then take a test. Includes printable lists, retries, and tricky-word review.
- **Verses:** parent-provided wording, read/listen, progressive blanks, first letters, memory typing, and reference quizzes. Samples use public-domain KJV.
- **Progress:** first-try test accuracy, separate Learn history, verse mastery, and practice streaks.
- **Sharing (Cloudflare):** share an immutable spelling list with sentences and an optional verse, or publish a single-admin class feed. Families import independent copies; no public library or search.
- **Phones:** install the Cloudflare build on your home screen; app shell loads offline, but family data and saving require internet.

- Project status, roadmap and decisions: [STATUS.md](STATUS.md)

## Privacy

No ads, analytics, trackers, email, or login provider. Use first names or nicknames only. A Family Code opens a family's practice; its Parent PIN protects editing and backups. Save both: there is no email recovery. Parents can export or delete their data.

Optional share links expose only the selected list title/date, note, words and sentences, plus a selected verse. Class feeds expose their name and published weeks. Never put private details in those fields. Anyone with the link can view or copy it until its owner stops sharing; imported copies remain independent. Profiles, family codes and progress are not included.

Cloud voice sends only spoken text to Cloudflare Workers AI, with device speech as an alternative/fallback. Public shell assets are cached on the device; family API data and answers are not stored in the offline cache. Already-heard audio has a bounded, volatile memory cache. Hosting request logs may contain normal technical information. Optional operator statistics contain aggregates only.

## Self-host: Cloudflare (multi-family)

Requires Node.js 24+, a Cloudflare account, Workers Static Assets, SQLite-backed Durable Objects, and Workers AI. No npm runtime dependencies or build step.

```sh
node --test
node cloudflare/deploy.mjs --dry-run  # no network calls
```

Set `CF_API_TOKEN` and `CF_ACCOUNT_ID`, and provide Worker secrets `SESSION_SECRET` and `IP_HASH_SALT` (each at least 32 characters). **Keep SESSION_SECRET stable** across releases. Optional `OPS_TOKEN` enables private aggregate stats. Then:

```sh
node cloudflare/deploy.mjs
```

The uploader does not configure DNS or hostnames. See [the deployment guide](cloudflare/deploy.md) for token scopes, hostname setup, local Wrangler smoke tests, migrations, and free-tier speech quotas. See [PWA notes](cloudflare/PWA.md) for install/cache behavior and release versioning.

## Self-host: Node / Docker (one family, trusted LAN)

The legacy build uses Node.js 24's built-in SQLite and optional Wyoming/Piper speech. It is separate from the multi-family Worker and does not include its Learn/PWA features. New databases contain fictional Sam/Alex sample profiles.

```sh
HOST=127.0.0.1 PARENT_PIN=2468 node server.js
# Open http://localhost:8088
```

No `npm install` needed. Set `DATA_DIR` to choose persistent storage and `PORT` to change the default 8088. The default host is `0.0.0.0`; use loopback for local-only access. This build's PIN is an editing gate, not public-internet authentication.

Piper is optional; without it, device speech is used. Configure your own service with `PIPER_HOST=your-piper-host` (default empty), `PIPER_PORT=10200`, and optional `PIPER_VOICE=en_US-lessac-high`.

```sh
PARENT_PIN=2468 docker compose up -d --build
```

Compose publishes on loopback by default; set `LAN_BIND_IP` for a trusted LAN interface. Persist the `/data` volume and change the example PIN. Do not port-forward the LAN build.

## Backups and contributing

Parent mode exports JSON/CSV and restores JSON transactionally. Import replaces current practice data, so export first. Keep codes/backups private. For Node filesystem backups, stop the app and copy its complete data directory, including SQLite sidecars.

Bug reports and pull requests are welcome. Read [AGENTS.md](AGENTS.md), use fictional fixtures, preserve both builds, and run `node --test`. Development and optional Chromium smoke checks are documented in [cloudflare/deploy.md](cloudflare/deploy.md). Report vulnerabilities through [GitHub private vulnerability reporting](SECURITY.md).

[MIT](LICENSE) · Copyright (c) 2026 Eric Jung.

## Connect an AI assistant

In the hosted Worker build, open **Parent mode**, unlock with your PIN, then choose **Connect an AI assistant**. Create a named connection with **Add & read** (default) or **Read only** access. Save its connection URL immediately: it is shown only once. Up to five connections can be active.

- **Claude:** Settings → Connectors → Add custom connector → paste the URL.
- **Claude Code:** `claude mcp add --transport http family-practice <url>`
- **Other clients:** use any MCP client supporting Streamable HTTP. The URL is `https://<your-origin>/mcp/t/<token>`. Header-capable clients can instead use `https://<your-origin>/mcp` with `Authorization: Bearer <token>`.

Anyone with this link can add and read your family's lists. Revoke it if shared by mistake. Read-only connections cannot change content. Parent PIN changes do **not** revoke connections; use **Revoke** or **Revoke all**. Deleting the family removes all connections.

The seven tools list kids/lists, read a list, add/update a spelling list, add a parent-provided verse and read aggregate progress. Ask the assistant for kid-friendly example sentences; missing sentences stay blank. Supply your family's own verse translation text rather than asking it to invent scripture (public-domain KJV/WEB is fine). No delete tools exist. The server stores only token hashes, uses no accounts or OAuth, and supports the stateless legacy initialize lifecycle with MCP `2025-11-25` (with `2025-06-18` and `2025-03-26` negotiation). Limits are 60 requests/minute/connection, 20 writes/hour/family, and 256 KiB/request.
