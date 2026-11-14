# Mobile and installable shell

The public Cloudflare build is installable with `/manifest.webmanifest`, generated
192/512px maskable PNGs, an iOS 180px touch icon, and `/sw.js`. All requests stay
first-party. Regenerate icons with `node cloudflare/scripts/generate-icons.mjs`
(Node built-ins only; committed PNGs mean no deployment build step).

## Release maintenance

**Bump `VERSION` in `public/sw.js` whenever releasing changes to shell assets**
(index, app, PWA hooks, styles, icons, manifest). Cache-first assets would otherwise
stay stale. A new worker waits for existing app tabs to close before activating,
then deletes only older `family-practice-shell-*` caches. Close all app tabs and
reopen to receive a waiting release. `/sw.js` has no-store/no-cache headers in both
asset configuration and the Worker's static-response path; registration also
bypasses browser update caching.

Only public shell paths are persisted. Navigations use the generic cached shell;
private `/f/<code>` URLs and family API responses are never written to
CacheStorage. Data APIs and mutations are network-only, with no offline queue.
The app is **not an offline practice app**: opening the shell offline shows a
connection notice, but family loading and saving require internet.

The sole API exception is GET `/api/tts`: successful MP3 responses can be reused
in volatile worker memory, not on disk. Entries are scoped to browser client and
family header, expire after 10 minutes, and are limited to 24 clips of 512 KiB
each (12 MiB maximum audio). Worker termination discards them. No POST/error
responses are cached; original app speech remains bounded session-memory too.

`pwa.js` adds install guidance only when unlocked parent voice settings are in
the DOM. Android/Chromium's install button appears when the browser emits
`beforeinstallprompt`; otherwise browser-menu guidance is shown. iOS explains
Safari → Share → Add to Home Screen. Installation eligibility and OS prompts
remain browser-controlled, and installed/browser storage may differ on iOS.

Safe-area padding, >=44px button/summary targets, wrapping and grid constraints
support narrow screens without disabling zoom. Focus/visual-viewport hooks keep
answer inputs visible when a keyboard resizes the viewport. The app primes one silent, reusable HTMLAudioElement synchronously inside the
first pointer/keyboard gesture, before session requests, and reuses it for cloud
clips. The Web Audio context is also resumed in gestures; device-speech fallback
is preserved. Physical iOS keyboard, installed Safari and
hardware audio behavior still need device verification.

## Verification

`node --test cloudflare/test/pwa.test.js` checks assets, PNG dimensions, actual
service-worker handler behavior (cache cleanup, API network-only and bounded
family/client-scoped voice memory), and worker headers. Full `node --test` must
remain green. `cloudflare/ui-smoke.mjs` additionally checks real browser manifest
fetches and active service-worker registration.
