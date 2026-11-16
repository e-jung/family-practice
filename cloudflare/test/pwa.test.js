import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import worker from '../worker.js';
const asset = path => readFile(new URL(`../public/${path}`, import.meta.url));
async function harness() {
  const events = {}, stores = new Map(), calls = [];
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return { async addAll(paths) { for (const path of paths) store.set(path, new Response(`shell:${path}`)); }, async match(path) { return store.get(path)?.clone(); } };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const context = { self: { location: { origin: 'https://practice.test' }, clients: { async claim() {} }, addEventListener(type, fn) { events[type] = fn; } }, caches, URL, Response, Map, Date, JSON,
    async fetch(request, options) { calls.push([request, options]); return new Response('voice', { headers: { 'Content-Type': 'audio/mpeg' } }); } };
  vm.runInNewContext((await asset('sw.js')).toString(), context);
  async function lifecycle(name) { let promise; events[name]({ waitUntil(p) { promise = p; } }); await promise; }
  async function fetchPath(path, { method = 'GET', family = 'family-one', clientId = 'client-one', mode } = {}) {
    let promise;
    const request = new Request('https://practice.test' + path, { method, headers: { 'X-Family-Code': family } });
    events.fetch({ request: mode ? { url: request.url, method, mode, headers: request.headers } : request, clientId, respondWith(p) { promise = p; } });
    return promise ? await promise : undefined;
  }
  return { stores, caches, calls, lifecycle, fetchPath };
}
test('installable manifest, generated real PNG icons and external mobile module are shipped', async () => {
  const manifest = JSON.parse(await asset('manifest.webmanifest'));
  assert.equal(manifest.start_url, '/'); assert.equal(manifest.display, 'standalone');
  for (const name of ['icon-180', 'icon-192', 'icon-512', 'icon-maskable-192', 'icon-maskable-512']) {
    const png = await asset(`icons/${name}.png`), size = Number(name.split('-').pop());
    assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  }
  // Maskable icons are full-bleed (opaque RGB); iOS needs an opaque apple-touch icon too.
  for (const name of ['icon-180', 'icon-maskable-192', 'icon-maskable-512']) assert.equal((await asset(`icons/${name}.png`))[25], 2);
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'));
  for (const icon of manifest.icons) await asset(icon.src.slice(1));
  assert.match((await asset('icons/icon.svg')).toString(), /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  const html = (await asset('index.html')).toString();
  assert.match(html, /rel="manifest"/); assert.match(html, /apple-touch-icon/); assert.match(html, /viewport-fit=cover/); assert.match(html, /src="\/pwa.js"/);
});
test('service worker caches only shell and cleans only its own older versions', async () => {
  const h = await harness();
  await h.caches.open('family-practice-shell-old'); await h.caches.open('unrelated');
  await h.lifecycle('install'); await h.lifecycle('activate');
  assert.ok(!h.stores.has('family-practice-shell-old')); assert.ok(h.stores.has('unrelated'));
  assert.equal(await (await h.fetchPath('/style.css')).text(), 'shell:/style.css');
  assert.equal(await (await h.fetchPath('/f/private-code', { mode: 'navigate' })).text(), 'shell:/');
  assert.ok(![...h.stores.values()].some(store => [...store.keys()].some(key => key.includes('private-code') || key.startsWith('/api/'))));
  assert.equal(h.calls.length, 0);
});
test('all data APIs and mutations use network; TTS memory is bounded and family/client scoped', async () => {
  const h = await harness();
  await h.fetchPath('/api/state'); await h.fetchPath('/api/state'); await h.fetchPath('/api/tts', { method: 'POST' });
  assert.equal(h.calls.length, 3); assert.ok(h.calls.every(([, options]) => options.cache === 'no-store'));
  await h.fetchPath('/api/tts?text=word'); await h.fetchPath('/api/tts?text=word');
  assert.equal(h.calls.length, 4);
  await h.fetchPath('/api/tts?text=word', { family: 'family-two' });
  await h.fetchPath('/api/tts?text=word', { clientId: 'client-two' });
  assert.equal(h.calls.length, 6);
  for (let i = 0; i < 25; i++) await h.fetchPath(`/api/tts?text=word${i}`);
  await h.fetchPath('/api/tts?text=word'); assert.equal(h.calls.length, 32);
  assert.equal(h.stores.size, 0);
});
test('worker serves service worker with explicit no-store and first-party CSP', async () => {
  const response = await worker.fetch(new Request('https://practice.test/sw.js'), { ASSETS: { async fetch() { return new Response('// worker'); } } }, {});
  assert.match(response.headers.get('Cache-Control'), /no-cache.*no-store/);
  assert.match(response.headers.get('Content-Security-Policy'), /worker-src 'self'; manifest-src 'self'/);
  assert.equal(response.headers.get('Service-Worker-Allowed'), '/');
});
test('shell caches every self-hosted font, sound, and module, each with its license', async () => {
  const source = (await asset('sw.js')).toString();
  const shell = JSON.parse(source.match(/const SHELL = (\[[^\]]+\])/)[1].replaceAll("'", '"'));
  for (const path of shell.filter(p => p !== '/')) assert.ok((await asset(path.slice(1))).length > 0, `${path} exists`);
  const required = [
    '/feedback.js', '/keyboard.js', '/icons.js', '/fonts/practice-reader-regular.woff2',
    '/fonts/barlow-condensed-bold.woff2', '/audio/interface-click-002.mp3',
    '/speech.js', '/spelling.js', '/verses.js', '/progress.js', '/parent.js', '/welcome.js',
    '/practice-round.js', '/verse-mastery.js',
  ];
  for (const path of required) assert.ok(shell.includes(path), `${path} is in the shell`);
  const woff2 = await asset('fonts/practice-reader-regular.woff2');
  assert.equal(woff2.subarray(0, 4).toString(), 'wOF2');
  for (const license of ['practice-reader-OFL.txt', 'barlow-condensed-OFL.txt', 'kenney-CC0.txt', 'README.txt']) assert.ok((await asset('licenses/' + license)).length > 200);
  const css = (await asset('style.css')).toString();
  assert.doesNotMatch(css, /url\(\s*["']?https?:/, 'fonts are first-party');
});
