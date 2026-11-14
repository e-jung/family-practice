// Local-only mobile header regression and review captures. No live speech calls.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.SMOKE_URL || 'http://localhost:8792';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw Error('Use disposable localhost only');
const out = process.argv[2] || '.tools/practice-fix';
await mkdir(out, {recursive: true});
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox']});
const errors = [];
let code;
try {
  const seed = await browser.newPage();
  await seed.goto(origin + '/privacy');
  code = await seed.evaluate(async () => {
    let code = '';
    const call = async (path, data) => {
      const r = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Family-Code': code}, body: JSON.stringify(data)});
      const b = await r.json(); if (!r.ok) throw Error(path + ': ' + JSON.stringify(b)); return b;
    };
    code = (await call('/api/families', {pin: '2468'})).code;
    await call('/api/parent/unlock', {pin: '2468'});
    await call('/api/admin/kids', {name: 'Sam'});
    const state = await (await fetch('/api/state', {headers: {'X-Family-Code': code}})).json();
    const kid = state.kids[0];
    const words = 'beautiful kind friend light because journey quiet garden apple house school water happy laugh again there would thought through people little morning mother father sister brother yellow purple orange green window flower summer winter spring autumn number letter story family'.split(' ');
    for (const count of [16, 25, 40]) await call('/api/admin/lists', {kid_id: kid.id, title: `${count} word practice`, words: words.slice(0, count).map(word => ({word, sentence: ''}))});
    return code;
  });
  await seed.close();
  for (const size of [{width: 390, height: 844}, {width: 360, height: 740}, {width: 1280, height: 900}]) {
    const mobile = size.width < 600, inset = mobile ? 47 : 0;
    const context = await browser.newContext({viewport: size, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce'});
    await context.addInitScript(code => {
      localStorage.setItem('family-practice-code', code);
      speechSynthesis.speak = u => setTimeout(() => u.onend?.(), 10);
      speechSynthesis.cancel = () => {};
    }, code);
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/api/tts?*', route => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":"mock device fallback"}'}));
    page.on('dialog', d => d.accept());
    await page.goto(origin);
    await page.getByRole('button', {name: /Sam/}).click();
    // A custom property substitutes env(safe-area-inset-top) in headless Chromium.
    await page.evaluate(inset => document.documentElement.style.setProperty('--practice-safe-top', `${inset}px`), inset);
    for (const count of [16, 25, 40]) {
      const list = page.locator('article, section.packet').filter({has: page.getByRole('heading', {name: `${count} word practice`, exact: true})});
      await list.getByRole('button', {name: 'Test', exact: true}).click();
      await page.getByLabel('Shuffle the words').uncheck();
      await page.getByRole('button', {name: 'Let’s begin'}).click();
      await page.getByLabel('Type the spelling word', {exact: true}).waitFor();
      const layout = await page.evaluate(() => {
        const band = document.querySelector('.practice-band'), button = band.querySelector('button'), cells = band.querySelector('.chart-cells');
        const b = button.getBoundingClientRect(), c = cells.getBoundingClientRect();
        return {overflow: document.documentElement.scrollWidth > innerWidth, buttonTop: b.top, buttonHeight: b.height, nowrap: getComputedStyle(button).whiteSpace, cellRight: c.right, cellWidth: c.width, cellScroll: cells.scrollWidth, cellCount: cells.children.length, voiceVisible: getComputedStyle(document.getElementById('voice-status')).display !== 'none'};
      });
      assert.equal(layout.overflow, false);
      assert.ok(layout.buttonTop >= inset);
      assert.equal(layout.nowrap, 'nowrap');
      assert.ok(layout.buttonHeight <= 56, 'exit is a single line');
      assert.ok(layout.cellRight <= size.width && layout.cellScroll <= layout.cellWidth + 1);
      assert.equal(layout.cellCount, count);
      assert.equal(layout.voiceVisible, false);
      await page.evaluate(() => scrollTo(0, 120));
      assert.ok(await page.locator('.practice-band').evaluate(b => Math.abs(b.getBoundingClientRect().top) < 1), 'band stays pinned while scrolling');
      assert.ok(await page.getByRole('button', {name: 'End practice'}).evaluate(b => b.getBoundingClientRect().top >= 47 || innerWidth > 600), 'exit remains below simulated status bar');
      await page.evaluate(() => scrollTo(0, 0));
      const capture = count === 16 && size.width !== 360;
      const label = mobile ? 'mobile' : 'desktop';
      if (capture) await page.screenshot({path: `${out}/test-band-${label}.png`});
      await page.getByRole('button', {name: 'End practice'}).click();
      if (capture) {
        await list.getByRole('button', {name: 'Learn', exact: true}).click();
        const answer = page.getByLabel('Type the full word', {exact: true});
        await answer.fill('beautiful');
        await page.getByRole('button', {name: 'Check word'}).click();
        await page.getByRole('button', {name: 'Continue', exact: true}).click();
        await page.getByText('Stage 2 of 4 · Fade', {exact: true}).waitFor();
        await page.screenshot({path: `${out}/learn-long-fade-${label}.png`});
        // First-try Fade skips Fade more, but does not learn until Recall succeeds.
        await answer.fill('beautiful');
        await page.getByRole('button', {name: 'Check word'}).click();
        await page.getByRole('button', {name: 'Continue', exact: true}).click();
        await page.getByText('Stage 4 of 4 · Recall', {exact: true}).waitFor();
        await answer.fill('beautiful');
        await page.getByRole('button', {name: 'Check word'}).click();
        await page.getByRole('button', {name: 'Continue', exact: true}).click();
        await page.getByText('Stage 1 of 3 · Copy', {exact: true}).waitFor();
        await answer.fill('kind');
        await page.getByRole('button', {name: 'Check word'}).click();
        await page.getByRole('button', {name: 'Continue', exact: true}).click();
        await page.getByText('Stage 2 of 3 · Fade', {exact: true}).waitFor();
        await page.screenshot({path: `${out}/learn-four-letter-${label}.png`});
        await page.getByRole('button', {name: 'End learning'}).click();
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: 390×844, 360×740 and desktop × 16/25/40 words; simulated 47px safe area, sticky band, single-line exit, bounded segments, hidden child voice status; first-try Fade → Recall; six screenshots. Real iOS standalone remains unverified.');
} finally {
  // All fixtures live in the caller's disposable local Miniflare directory.
  await browser.close();
}
