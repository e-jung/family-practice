// Disposable localhost only. Run after the dedicated Parent page is available.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chromium node cloudflare/parent-layout-smoke.mjs [screenshot-dir]
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = new URL(process.env.SMOKE_URL || 'http://localhost:8792').origin;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw Error('Use disposable localhost only');
const smokeHeaders={'CF-Connecting-IP':`198.18.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*254)+1}`};
const out = process.argv[2] || '.tools/parent-mcp';
await mkdir(out, {recursive: true});
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox']});
const errors = [], external = [], report = [];
const pin = '2468', listTitle = 'Sixteen word smoke list', verseReference = 'Psalm 23:1';
const sections = ['Kids', 'Spelling lists', 'Bible verses', 'Shared lists', 'Class lists', 'Following', 'This device', 'Sign-in & email', 'Family', 'Connect an AI assistant'];
let fixture, code;
async function call(context, path, data) {
  const response = await context.request.post(origin + path, {headers: {'X-Family-Code': code || ''}, data});
  assert.ok(response.ok(), `${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
async function noOverflow(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: page has no horizontal overflow`);
}
async function kidTabs(page, label) {
  const nav = page.getByRole('navigation', {name: 'Practice sections'});
  await nav.waitFor();
  assert.deepEqual(await nav.getByRole('button').allTextContents(), ['Spelling', 'Bible Verses', 'Progress'], `${label}: exactly three kid tabs, even with Parent mode unlocked`);
  await noOverflow(page, label);
}
async function editDialog(page, kind, label) {
  // Parent management rows may be cards, table rows, or list items. Select the
  // nearest row containing both the fixture heading/text and its Edit button.
  const title = kind === 'spelling' ? listTitle : verseReference;
  const edit = page.getByText(title, {exact: true}).first().locator('xpath=ancestor::*[.//button[normalize-space()="Edit"]][1]').getByRole('button', {name: 'Edit', exact: true});
  const before = await page.evaluate(() => scrollY);
  await edit.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.getByRole('button', {name: 'Save', exact: true}).waitFor();
  // Measure immediately: scrolling to an individual control could conceal a
  // regression in which Save/Cancel initially sit below the viewport.
  const geometry = await dialog.evaluate(d => {
    const box = d.getBoundingClientRect();
    const controls = [...d.querySelectorAll('input:not([type=hidden]), textarea, select, button')].filter(e => e.getClientRects().length && !e.classList.contains('haptic-overlay'));
    return {pageY: scrollY, dialog: {left: box.left, right: box.right, top: box.top, bottom: box.bottom}, controls: controls.map(e => {
      const r = e.getBoundingClientRect();
      return {name: e.labels?.[0]?.textContent || e.textContent || e.type, type: e.type, fontSize: parseFloat(getComputedStyle(e).fontSize), left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, client: e.clientWidth, scroll: e.scrollWidth};
    }), width: innerWidth, height: innerHeight};
  });
  // Opening may scroll the clicked management row into view; no scrolling is used to reveal the sheet actions.
  assert.ok(geometry.controls.some(c => c.type === 'date'), `${label}: date control is checked`);
  for (const c of geometry.controls) {
    if (!['Save','Cancel'].includes(c.name.trim()) && ['text','date','textarea','select-one','password','number'].includes(c.type)) assert.ok(c.fontSize >= 16, `${label}: ${c.name} avoids iOS focus zoom`);
    assert.ok(c.width > 0 && c.left >= 0 && c.right <= geometry.width + 1, `${label}: ${c.name} fits viewport width`);
    assert.ok(c.left >= geometry.dialog.left && c.right <= geometry.dialog.right + 1, `${label}: ${c.name} fits dialog width`);
    assert.ok(c.scroll <= c.client + 1, `${label}: ${c.name} has no internal horizontal overflow`);
    if (["Save", "Cancel"].includes(c.name.trim())) assert.ok(c.top >= 0 && c.bottom <= geometry.height + 1, `${label}: ${c.name} is visible without scrolling`);
  }
  assert.ok(geometry.controls.some(c => c.name.trim() === 'Save'));
  assert.ok(geometry.controls.some(c => c.name.trim() === 'Cancel'));
  await noOverflow(page, label);
  await page.screenshot({path: `${out}/${label}.png`});
  report.push({label, geometry});
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
  await dialog.waitFor({state: 'hidden'});
}
try {
  fixture = await browser.newContext({extraHTTPHeaders:smokeHeaders});
  code = (await call(fixture, '/api/families', {pin, smoke: true})).code;
  await call(fixture, '/api/parent/unlock', {pin});
  await call(fixture, '/api/admin/kids', {name: 'Layout kid', grade: '3'});
  await call(fixture, '/api/admin/kids', {name: 'Second kid'});
  const stateResponse = await fixture.request.get(origin + '/api/state', {headers: {'X-Family-Code': code}});
  assert.ok(stateResponse.ok());
  const kid = (await stateResponse.json()).kids[0];
  await call(fixture, '/api/admin/lists', {kid_id: kid.id, title: listTitle, date: '2026-11-16', words: 'beautiful kind friend light because journey quiet garden apple house school water happy laugh again there'.split(' ').map(word => ({word, sentence: ''}))});
  await call(fixture, '/api/admin/verses', {kid_id: kid.id, reference: verseReference, text: 'The LORD is my shepherd; I shall not want.', translation: 'KJV', due_date: '2026-11-20'});
  for (const viewport of [{width: 390, height: 844}, {width: 360, height: 740}, {width: 1440, height: 1000}]) {
    const label = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({serviceWorkers:'block',extraHTTPHeaders:smokeHeaders,viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, reducedMotion: 'reduce'});
    // APIRequestContext shares the browser context's cookie jar; no forged cookie.
    await call(context, '/api/parent/unlock', {pin});
    await context.addInitScript(code => {
      localStorage.setItem('family-practice-code', code);
      localStorage.setItem('family-practice-device', JSON.stringify({keySounds: false, haptics: false, keyboard: 'auto'}));
      speechSynthesis.speak = u => setTimeout(() => u.onend?.(), 10);
      speechSynthesis.cancel = () => {};
    }, code);
    await context.route('**/api/tts?*', route => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":"smoke device fallback"}'}));
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('request', r => {if (new URL(r.url()).origin !== origin) external.push(r.url());});
    await page.goto(origin);
    await page.getByRole('button', {name: /Layout kid/}).click();
    await kidTabs(page, label);
    await page.screenshot({path: `${out}/kid-${label}.png`});
    const parentButton = page.locator('header').getByRole('button', {name: 'Parent mode', exact: true});
    await parentButton.click();
    await page.getByRole('button', {name: 'Done', exact: true}).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0, 'Parent mode opens a page, not a modal');
    await page.locator('header').getByRole('button', {name: 'Lock', exact: true}).waitFor();
    for (const section of sections) {
      const primary = ['Kids','Spelling lists','Bible verses','Family'];
      if (!primary.includes(section) && !await page.locator('.parent-more').evaluate(e => e.open)) await page.locator('.parent-more > summary').click();
      assert.deepEqual(await page.locator('.parent-primary button').allTextContents(), ['Kids','Lists','Verses','Family']);
      await page.getByRole('navigation', {name:'Parent sections'}).getByRole('button', {name: ({'Spelling lists':'Lists','Bible verses':'Verses'})[section] || section, exact: true}).click();
      if (section === 'Sign-in & email') await page.getByRole('heading', {name:'Parents linked to this family',exact:true}).waitFor();
      await noOverflow(page, `${section}-${label}`);
      const slug = section.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
      await page.screenshot({path: `${out}/parent-${slug}-${label}.png`, fullPage: true});
      if (section === 'Spelling lists') {
        const picker = page.getByLabel('Kid', {exact: true});
        await picker.selectOption({label: 'Second kid'});
        await page.getByText(listTitle, {exact: true}).waitFor({state:'hidden'});
        assert.equal(await page.getByLabel('Kid', {exact:true}).inputValue(), '2');
        await page.getByLabel('Kid', {exact:true}).selectOption({label:'Layout kid'});
        await page.getByText(listTitle, {exact:true}).waitFor();
        await editDialog(page, 'spelling', `edit-spelling-${label}`);
      }
      if (section === 'Bible verses') await editDialog(page, 'verse', `edit-verse-${label}`);
      if (section === 'Connect an AI assistant') {
        await page.getByLabel(/Name/, {exact: false}).fill(`Layout smoke ${label}`);
        const scope = page.getByLabel(/Scope/, {exact: false});
        await scope.waitFor(); // Keep the least-privilege/default scope selected.
        await page.getByRole('button', {name: 'Create connection', exact: true}).click();
        await page.getByText(/https?:\/\//).or(page.locator('input[value^="http"], textarea')).first().waitFor();
        await noOverflow(page, `created-connection-${label}`);
        await page.screenshot({path: `${out}/parent-connection-created-${label}.png`, fullPage: true});
        // Exercise migrated/retired metadata using real rows and real revocation.
        // Only the list response is adapted; no legacy-link creation API is exposed.
        // This layout context blocks SW interception; ui-smoke separately tests the real SW.
        const retiredList = async route => {
          const response = await route.fetch(), data = await response.json();
          data.connections = data.connections.map(c => ({...c, format:'retired'}));
          await route.fulfill({response, json:data});
        };
        await page.route('**/api/admin/connections', retiredList);
        await page.getByRole('navigation', {name:'Parent sections'}).getByRole('button', {name:'Family',exact:true}).click();
        if (!await page.locator('.parent-more').evaluate(e => e.open)) await page.locator('.parent-more > summary').click();
        await page.getByRole('navigation', {name:'Parent sections'}).getByRole('button', {name:section,exact:true}).click();
        await page.getByText('Retired — create a new link', {exact:true}).first().waitFor();
        await page.screenshot({path:`${out}/parent-connection-retired-${label}.png`,fullPage:true});
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', {name:'Revoke',exact:true}).last().click();
        await page.getByText('Retired — create a new link', {exact:true}).waitFor({state:'hidden'});
        await page.unroute('**/api/admin/connections', retiredList);

      }
    }
    await page.getByRole('button', {name: 'Done', exact: true}).click();
    await kidTabs(page, `Done-${label}`);
    // Reopening while already unlocked is the header regression this covers.
    await parentButton.click();
    await page.getByRole('button', {name: 'Done', exact: true}).waitFor();
    await page.locator('header').getByRole('button', {name: 'Lock', exact: true}).click();
    await page.locator('header').getByRole('button', {name: 'Lock', exact: true}).waitFor({state:'hidden'});
    await page.locator('header').getByRole('button', {name: 'Parent mode', exact: true}).click();
    await page.getByLabel('Parent PIN', {exact:true}).fill(pin);
    await page.getByRole('button', {name:'Unlock', exact:true}).click();
    await page.getByRole('button', {name:'Done', exact:true}).waitFor();
    assert.equal(await page.getByRole('dialog').count(),0,'PIN unlock opens dedicated Parent page');
    await context.close();
  }
  assert.deepEqual(errors, [], 'no browser page errors');
  assert.deepEqual(external, [], 'no third-party browser requests');
  await writeFile(`${out}/parent-layout-report.json`, JSON.stringify({viewports: ['390x844', '360x740', '1440x1000'], dialogs: report, errors, external}, null, 2));
  console.log(`PASS: three kid tabs; dedicated Parent page and separate Lock; all ten parent sections in primary/More groups; list/verse dialogs including dates and Save/Cancel fit without page scrolling; created connection URLs captured at 390×844, 360×740, 1440×1000. Screenshots: ${out}`);
} finally {
  if (fixture && code) {
    try {
      await call(fixture, '/api/parent/unlock', {pin});
      await call(fixture, '/api/admin/delete-family', {pin, confirmation: code});
    } catch (error) {console.error('Disposable local fixture cleanup failed:', error.message);}
  }
  await browser.close();
}
