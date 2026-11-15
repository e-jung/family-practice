// Real-browser check of the old-hostname handoff, using two local origins:
// 127.0.0.1 plays the old host and localhost the new one. Playwright and Wrangler are tools only.
// WRANGLER_BIN=<wrangler> PLAYWRIGHT_MODULE=… node cloudflare/legacy-smoke.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = 8792, oldOrigin = `http://127.0.0.1:${port}`, newOrigin = `http://localhost:${port}`;
const data = await mkdtemp(join(tmpdir(), 'fp-legacy-'));
let wrangler;
async function start(vars) {
  wrangler = spawn(process.env.WRANGLER_BIN || 'wrangler', ['dev', '--config', '.tools/voice-local.toml', '--local', '--port', String(port), '--persist-to', data,
    '--var', 'SESSION_SECRET:local-test-secret-32-characters-long', '--var', 'IP_HASH_SALT:local-ip-hash-salt-32-characters-long', ...vars.flatMap(v => ['--var', v])],
    {stdio: 'ignore', env: {...process.env, WRANGLER_SEND_METRICS: 'false'}});
  for (let i = 0; i < 80; i++) { try { await fetch(newOrigin + '/'); return; } catch { await new Promise(r => setTimeout(r, 500)); } }
  throw Error('wrangler did not start');
}
async function stop() { wrangler.kill('SIGINT'); await new Promise(r => wrangler.once('exit', r)); await new Promise(r => setTimeout(r, 500)); }
const profile = await mkdtemp(join(tmpdir(), 'fp-legacy-profile-'));
const launch = async dir => chromium.launchPersistentContext(dir, {headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox']});
const context = await launch(profile), deep = await launch(await mkdtemp(join(tmpdir(), 'fp-legacy-deep-')));
let checks = 0;
try {
  // 1. A device uses the app on the old origin: service worker installed, Family Code saved.
  await start([]);
  for (const ctx of [context, deep]) {
    const page = await ctx.newPage();
    await page.goto(oldOrigin + '/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.evaluate(() => localStorage.setItem('family-practice-code', 'TEST-HAND-OFF1'));
    await page.reload();
    assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true, 'old SW controls the page'); checks++;
    assert.equal(await page.title(), 'Spellami'); checks++;
    await page.close();
  }
  await stop();

  // 2. The old origin becomes a legacy host. Reopening it must land on the new origin's join page.
  await start(['LEGACY_HOSTS:127.0.0.1', `APP_ORIGIN:${newOrigin}`]);
  const plain = await fetch(oldOrigin + '/s/abc?x=1', {redirect: 'manual'});
  assert.equal(plain.status, 301); assert.equal(plain.headers.get('Location'), newOrigin + '/s/abc?x=1'); checks += 2;
  assert.equal((await fetch(oldOrigin + '/sw.js', {redirect: 'manual'})).status, 200); checks++;
  const mcp = await fetch(oldOrigin + '/mcp', {method: 'POST', redirect: 'manual', headers: {'Content-Type': 'application/json'}, body: '{}'});
  assert.equal(mcp.status, 401, 'MCP answers in place on the old host'); checks++;
  // A device with the app opens a deep link on the old host: the path survives the handoff.
  const deepPage = await deep.newPage();
  await deepPage.goto(oldOrigin + '/s/abc?x=1');
  await deepPage.waitForURL(url => url.origin === newOrigin, {timeout: 30000});
  assert.equal(new URL(deepPage.url()).pathname + new URL(deepPage.url()).search, '/s/abc?x=1', 'deep link kept'); checks++;
  const again = await context.newPage();
  await again.goto(oldOrigin + '/');
  await again.waitForURL(url => url.origin === newOrigin, {timeout: 30000});
  assert.equal(new URL(again.url()).pathname, '/f/TEST-HAND-OFF1', 'saved code handed to the new origin'); checks++;
  await again.waitForSelector('input');
  assert.equal(await again.evaluate(() => [...document.querySelectorAll('input')].some(i => i.value === 'TEST-HAND-OFF1')), true, 'join page prefilled'); checks++;
  const check = await context.newPage();
  await check.goto(oldOrigin + '/moved.js');
  assert.equal(await check.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0, 'old-origin SW unregistered'); checks++;
  // A fresh device with nothing saved simply follows the 301.
  const fresh = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox']});
  const freshPage = await fresh.newPage();
  await freshPage.goto(oldOrigin + '/privacy');
  assert.equal(freshPage.url(), newOrigin + '/privacy'); checks++;
  await fresh.close();
  console.log(`PASS: legacy handoff, ${checks} checks (old SW replaced, code handed to /f/, deep link kept, SW unregistered, MCP in place, 301 for fresh devices).`);
} finally {
  await context.close(); await deep.close();
  if (wrangler && wrangler.exitCode === null) await stop();
}
