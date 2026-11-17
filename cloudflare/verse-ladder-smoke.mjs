// Disposable localhost browser evidence; no live speech or family data.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {tokenize, maskWords} from './public/verse-ladder.js';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.SMOKE_URL || 'http://localhost:8792';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw Error('Use disposable localhost only');
const out = process.argv[2] || '.tools/verse-ladder';
await mkdir(out, {recursive: true});
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox']});
const errors = [];
const verse = 'The LORD is my shepherd; I shall not want.';
const letters = tokenize(verse).map(w => w[0].toLowerCase()).join('');
try {
  for (const mobile of [true, false]) {
    const label = mobile ? 'mobile' : 'desktop';
    const context = await browser.newContext({viewport: mobile ? {width: 390, height: 844} : {width: 1280, height: 900},
      isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block',
      extraHTTPHeaders: {'CF-Connecting-IP': `198.18.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*250)+1}`}});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.text().includes('400 (Bad Request)')) errors.push(m.text()); });
    await page.goto(origin + '/privacy');
    const code = await page.evaluate(async verse => {
      let code = '';
      const call = async (path, data) => {
        const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Family-Code': code},
          body: JSON.stringify(data)});
        const result = await response.json();
        if (!response.ok) throw Error(JSON.stringify(result));
        return result;
      };
      code = (await call('/api/families', {pin: '2468', smoke: true})).code;
      await call('/api/parent/unlock', {pin: '2468'});
      await call('/api/admin/kids', {name: 'Sam'});
      const state = await (await fetch('/api/state', {headers: {'X-Family-Code': code}})).json();
      await call('/api/admin/verses', {kid_id: state.kids[0].id, reference: 'Psalm 23:1', text: verse, translation: 'KJV'});
      // Exercise the kid-only aggregate resume endpoint, not a parent cookie.
      await call('/api/parent/lock', {});
      localStorage.setItem('family-practice-code', code);
      localStorage.setItem('family-practice-device', JSON.stringify({keyboard: 'off', haptics: false}));
      return code;
    }, verse);
    await page.goto(origin);
    await page.getByRole('button', {name: /Sam/}).click();
    await page.getByRole('button', {name: 'Bible Verses', exact: true}).click();
    await page.getByRole('button', {name: 'Practice this verse'}).click();
    assert.equal(await page.locator('ol.modes li').count(), 3);
    await page.getByRole('button', {name: /Learn it/}).click();
    await page.getByRole('heading', {name: 'Step 1 of 4', exact: true}).waitFor();
    assert.equal(await page.locator('textarea, input').count(), 0);
    const type = async text => {
      if (mobile) for (const letter of text) await page.locator('[data-keyboard]').getByRole('button', {name: letter, exact: true}).tap();
      else await page.keyboard.type(text);
    };
    assert.equal(await page.locator('[data-keyboard]').count(), 1);
    // A click outside the word desk must not disable physical first-letter input.
    await page.locator('.practice-band').count().then(async count => {
      if (count) await page.locator('.practice-band').click({position: {x: 5, y: 5}});
      else await page.locator('body').click({position: {x: 2, y: 2}});
    });
    await page.screenshot({path: `${out}/${label}-step1.png`});
    await type(letters);
    await page.getByRole('button', {name: 'Next step', exact: true}).click();
    await page.getByRole('heading', {name: 'Step 2 of 4', exact: true}).waitFor();
    assert.equal(await page.locator('.hidden-word').count(), maskWords(verse, 2).filter(Boolean).length);
    await page.screenshot({path: `${out}/${label}-step2.png`});
    // Also verify physical input in the mobile viewport.
    if (mobile) {
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.type(letters[0]);
      await type(letters.slice(1));
    } else await type(letters);
    await page.getByRole('button', {name: 'Next step', exact: true}).waitFor();
    await page.getByRole('button', {name: 'Choose a mode', exact: true}).click();
    await page.getByRole('button', {name: /Learn it/}).click();
    await page.getByRole('heading', {name: 'Step 3 of 4', exact: true}).waitFor();
    await type('z'.repeat(letters.length));
    await page.getByRole('button', {name: 'Try again', exact: true}).click();
    await page.getByRole('heading', {name: 'Step 3 of 4', exact: true}).waitFor();
    await type(letters);
    await page.getByRole('button', {name: 'Next step', exact: true}).click();
    await page.getByRole('heading', {name: 'Step 4 of 4', exact: true}).waitFor();
    await page.screenshot({path: `${out}/${label}-step4.png`});
    await type(letters);
    await page.getByRole('heading', {name: 'You learned it!', exact: true}).waitFor();
    await page.screenshot({path: `${out}/${label}-learned.png`});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const progress = await page.evaluate(async code => (await fetch('/api/progress?kid=1',
      {headers: {'X-Family-Code': code}})).json(), code);
    assert.equal(progress.mastery[0].stars, 3);
    assert.equal(progress.ladderSteps[0].step, 4);
    assert.equal(progress.verseAttempts, undefined);
    // Simulate a stale cached wording rejected by the server; no endless save loop.
    await page.getByRole('button', {name: 'Choose a mode', exact: true}).click();
    await page.getByRole('button', {name: /Learn it/}).click();
    await page.getByRole('heading', {name: 'Step 4 of 4', exact: true}).waitFor();
    await page.route('**/api/verse-attempts', route => route.fulfill({status: 400,
      contentType: 'application/json', body: JSON.stringify({error: 'Invalid ladder letters'})}), {times: 1});
    await type(letters);
    await page.getByRole('heading', {name: 'Let’s start that step again', exact: true}).waitFor({timeout: 5000})
      .catch(async err => { console.log(label, await page.locator('body').innerText(), errors); throw err; });
    await page.getByRole('button', {name: 'Try again', exact: true}).click();
    await page.getByRole('heading', {name: 'Step 4 of 4', exact: true}).waitFor();
    await type(letters);
    await page.getByRole('heading', {name: 'You learned it!', exact: true}).waitFor();
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: mobile touch + physical and desktop physical; all four steps, fail/retry, kid-only resume, mastery; ' +
    'keyboard off still has pad; focus recovery; stale-answer restart; no textarea/overflow; ' +
    'zero unexpected console/page errors (intentional HTTP 400); 8 screenshots');
} finally { await browser.close(); }
