import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {legacyResponse, legacyHosts} from '../legacy.js';
import worker from '../worker.js';

const env = {APP_ORIGIN: 'https://spellami.jesklabs.com', LEGACY_HOSTS: 'spelling.jesklabs.com'};
const at = (path, init) => legacyResponse(new Request('https://spelling.jesklabs.com' + path, init), env);

test('legacy hosts are opt-in and never match the canonical origin', () => {
  assert.deepEqual(legacyHosts({}), []);
  assert.deepEqual(legacyHosts({LEGACY_HOSTS: ' Spelling.jesklabs.com, ,old.example '}), ['spelling.jesklabs.com', 'old.example']);
  assert.equal(legacyResponse(new Request('https://spelling.jesklabs.com/'), {APP_ORIGIN: env.APP_ORIGIN}), null);
  assert.equal(legacyResponse(new Request('https://spellami.jesklabs.com/'), {...env, LEGACY_HOSTS: 'spellami.jesklabs.com'}), null);
  assert.equal(legacyResponse(new Request('https://spellami.jesklabs.com/api/state'), env), null);
});

test('old pages 301 with path and query; MCP stays in place; old APIs are gone', async () => {
  for (const path of ['/', '/f/ABCD-EFGH', '/s/AbCdEf0123456789?x=1', '/c/abc', '/privacy', '/auth/jesklabs/callback?code=1&state=2', '/manifest.webmanifest']) {
    const r = at(path);
    assert.equal(r.status, 301, path);
    assert.equal(r.headers.get('Location'), 'https://spellami.jesklabs.com' + path);
  }
  for (const path of ['/mcp', '/mcp/t/fpc2.abc']) assert.equal(at(path, {method: 'POST', body: '{}'}), null, path);
  const api = at('/api/state', {method: 'POST', body: '{}'});
  assert.equal(api.status, 410);
  assert.match((await api.json()).error, /moved to https:\/\/spellami\.jesklabs\.com/);
  assert.equal(at('/api/tts', {method: 'HEAD'}).status, 410);
});

test('old origin keeps a 200 handoff service worker and a code-forwarding page', async () => {
  const sw = at('/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('Content-Type'), /javascript/);
  assert.equal(sw.headers.get('Cache-Control'), 'no-store');
  assert.equal(sw.headers.get('Service-Worker-Allowed'), '/');
  const swText = await sw.text();
  assert.match(swText, /skipWaiting/);
  assert.match(swText, /fetch\('\/moved'/);
  assert.doesNotThrow(() => new vm.Script(swText));
  const page = await at('/moved').text();
  assert.match(page, /<script src="\/moved\.js"><\/script>/);
  assert.match(at('/moved').headers.get('Content-Security-Policy'), /script-src 'self'/);
  const script = await at('/moved.js').text();
  assert.doesNotThrow(() => new vm.Script(script));

  async function run(href, stored) {
    const q = href.indexOf('?'), pathname = q < 0 ? href : href.slice(0, q), search = q < 0 ? '' : href.slice(q);
    let replaced = null, unregistered = 0;
    const context = {
      URLSearchParams, encodeURIComponent,
      localStorage: {getItem: key => key === 'family-practice-code' ? stored : null},
      navigator: {serviceWorker: {getRegistrations: async () => [{unregister: async () => { unregistered++; }}]}},
      location: {pathname, search, replace: url => { replaced = url; }},
    };
    vm.runInNewContext(script, context);
    for (let i = 0; i < 20 && replaced === null; i++) await new Promise(r => setImmediate(r));
    return {replaced, unregistered};
  }
  assert.deepEqual(await run('/', 'ABCD-EFGH'), {replaced: 'https://spellami.jesklabs.com/f/ABCD-EFGH', unregistered: 1});
  assert.equal((await run('/?auth=error', 'ABCD-EFGH')).replaced, 'https://spellami.jesklabs.com/f/ABCD-EFGH');
  assert.equal((await run('/moved', 'ABCD-EFGH')).replaced, 'https://spellami.jesklabs.com/f/ABCD-EFGH');
  assert.equal((await run('/', null)).replaced, 'https://spellami.jesklabs.com/');
  assert.equal((await run('/s/abc?x=1', 'ABCD-EFGH')).replaced, 'https://spellami.jesklabs.com/s/abc?x=1');
  assert.equal((await run('/f/OTHER-CODE', 'ABCD-EFGH')).replaced, 'https://spellami.jesklabs.com/f/OTHER-CODE');
  assert.equal((await run('/privacy', null)).replaced, 'https://spellami.jesklabs.com/privacy');
  assert.equal((await run('//evil.example/x', 'X')).replaced, 'https://spellami.jesklabs.com/f/X');
});

test('worker routes the legacy host before auth, assets or APIs', async () => {
  const r = await worker.fetch(new Request('https://spelling.jesklabs.com/f/ABCD?x=1'), env, {waitUntil() {}});
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://spellami.jesklabs.com/f/ABCD?x=1');
});
