# Local sign-in smoke fixture

**Never deploy these configurations or bind this fake to a deployed app.** The fake
requires `ENVIRONMENT=dev`, a localhost app origin, and localhost public requests.
Production configuration does not reference it. Code `123456` is fixed; no email
or Google request is sent. Google uses `google-local@example.com`. A SQLite DO
shares state between named `SpellingClient` RPC and browser endpoints. Grants and
attach tickets are one-use, expiring capabilities; code exchange verifies S256
PKCE and the exact callback. This is a protocol fixture, not a security/provider
implementation. Do not use real identities or secrets.

From the repository root, run these in **two terminals** (the second server uses
Wrangler's local service discovery for `SpellingClient`):

```bash
WRANGLER_SEND_METRICS=false npx wrangler dev -c cloudflare/local-accounts/wrangler.toml --local --port 8793 --persist-to .tools/signin-fake-data
WRANGLER_SEND_METRICS=false npx wrangler dev -c cloudflare/wrangler.signin-local.toml --local --port 8792 --persist-to .tools/signin-accounts-data
```

Keep `localhost` consistent: cookies are shared across localhost ports. Chromium
accepts Secure `__Host-` cookies on localhost. Both smoke programs refuse remote
origins. The app's localhost-only `ACCOUNTS_DEV=1` override must be enabled for
browser redirects; production always uses the real Accounts origin.

```bash
node cloudflare/signin-smoke.mjs
PLAYWRIGHT_MODULE="$PWD/.tools/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs" \
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/browsers" \
node cloudflare/signin-ui-smoke.mjs .tools/signin-accounts-ui
```

If your shell injects HTTP(S) proxies into Node, prefix the smoke commands with
`env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy`.

Default app/Accounts origins are `http://localhost:8792` / `http://localhost:8793`.
Override smoke destinations with `SMOKE_URL` / `SMOKE_ACCOUNTS_URL`, updating both
local configs' app/Accounts origins and dev ports consistently. Fixture databases
and screenshots live in ignored `.tools/`; remove/archive them after stopping the
servers to start a fresh run. Smokes remove their disposable family/account links.
