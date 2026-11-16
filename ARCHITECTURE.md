# ARCHITECTURE.md — Spellami north star

How Spellami should be shaped. `AGENTS.md` describes how the code works today and its constraints; `STATUS.md` holds live state, roadmap and recorded debt. If a change contradicts this file, stop and update it deliberately (with the maintainer) or don't make the change.

## Purpose

Help families practice weekly spelling lists and parent-provided Bible verses, and see progress. The hosted instance (https://spellami.jesklabs.com) is the product. The repo stays open source, and a stranger can run their own copy on one Cloudflare account from the README alone.

## Principles

1. **One app, one home.** One repo, one Cloudflare Worker, one deploy. Schedules (notification cron) live inside the Worker. There is no second build: the single-family Node/LAN build was retired on 2026-11-16 (last version tagged `lan-build-final`).
2. **Pure core, thin edges.** Grading, scheduling, mastery, validation and the practice-round lifecycles are pure functions with behavior tests. Durable Objects, HTTP routing, Workers AI, Resend, shared Accounts and the DOM are edges that call the core.
3. **One source of truth per rule.** A threshold, limit or rule is defined once and imported everywhere it is used (server, email digest, UI copy). No re-implementations.
4. **Explicit state machines.** Each practice flow (spelling test/review round, Learn, verse practice) is a reducer: named states, named events, tested transitions. The DOM renders state; it never *is* the state.
5. **Settings, not literals.** Tunable operational values live in one validated settings file. Instance identity (origin, sender, legacy hosts, sign-in) lives in an instance profile, not in code defaults.
6. **Small files.** Hand-written source ≤ 1,000 lines and readable line lengths, enforced by `npm run check`.
7. **Privacy and free tier are invariants** (see `AGENTS.md`): no child identity, no trackers, family isolation, free-tier budgets enforced in-app.

## Data model

- **Family** (one SQLite Durable Object per hashed Family Code): family settings and PIN hash; kids (first name, optional grade); spelling lists (title, date, words with sentences); verses (reference, text, translation); attempts (spelling, kind `test|learn|review`); verse attempts (mode, accuracy, wording); Leitner review bank (per kid, per normalized word); MCP connections (token hashes); class follows; linked parents (masked); daily ops counters.
- **Singletons:** `RegistryLimits` (rate limits, aggregate ops), `TtsCache` (speech clips), `ShareStore` (share links, class feeds), `AccountStore` (optional parent sign-in links, notification preferences and delivery claims).
- **Practice item:** a word (with sentence) or a verse. **Attempt:** item + mode + result. **Mastery:** derived from attempts by one policy per subject, never stored.

## Components and boundaries

| Layer | Where | Owns | Must not |
|---|---|---|---|
| Domain core | `lib/` (server) and pure modules in `cloudflare/public/` that both the browser and Worker import (no build step) | Answer checking, verse comparison, Leitner scheduling, verse mastery policy, round/Learn reducers, input validation, settings schema | Touch storage, network, DOM, `env` |
| Worker edge | `cloudflare/worker.js` (routing), `core.js` (family storage/API), `tts.js`, `sharing.js`, `accounts.js`, `notifications.js`, `emails.js`, `mcp.js`, `legacy.js` | HTTP, Durable Objects, vendors | Re-implement a domain rule |
| Browser shell | `cloudflare/public/app.js` (small router/shell) plus feature modules: practice, progress, parent, speech | Rendering and user events | Hold practice lifecycle in DOM flags or booleans |
| Deploy | `cloudflare/deploy.mjs` | Upload plan, bindings, settings and instance profile | Hard-code an instance's identity |

## Practice engine

One round engine drives practice; **spelling** and **verses** are its two subject entries (modes, how an answer is checked, how mastery is derived). A future subject would be one more entry. Nothing is built for subjects that don't exist yet.

## Config vs code

- **`cloudflare/settings.json`** (schema and defaults in one module): voice budgets, daily email cap, notification days and hours, review batch size and other operational limits. The deployer validates it and refuses to deploy invalid settings, so the last good version keeps running; the Worker validates again on load and falls back to defaults on error. Changing a value means editing the file and redeploying, with no code change.
- **Instance profile** (`cloudflare/instances/<name>.json`, selected with `--instance`): canonical origin, email sender, legacy hostnames, shared-Accounts binding and sign-in switches. `jesklabs.json` is the hosted instance. With no profile, defaults are neutral: no legacy hosts, no Accounts binding, sign-in and notifications off, and the self-hoster supplies their own origin.
- **Secrets** stay in the deployer's environment, never in either file.
- **Code:** everything else.

## Roadmap

1. **Guardrails and one build** — `npm run check` (tests, 1,000-line limit, line-length gate with a shrinking baseline for existing offenders) and CI; retire the LAN build.
2. **Settings and instance profile** — move tunables into `settings.json`, Jesklabs identity into `instances/jesklabs.json`, neutral defaults.
3. **One rule, once** — spelling-round reducer; one verse-mastery policy used by progress, digest and UI copy.
4. **Split the browser shell** — `app.js` into shell + feature modules, each ≤ 1,000 lines; reformat compressed one-line modules.
5. **Resume features** (paused during 1–4): verse spaced repetition, parent word-bank view.

## Non-goals

Multi-family self-hosting outside Cloudflare; an offline/LAN build; a live admin settings page; school accounts, rosters or a public content library; frameworks or a build step; building for practice subjects that aren't planned.
