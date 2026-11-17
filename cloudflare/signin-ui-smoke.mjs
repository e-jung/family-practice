// Disposable local app + local Accounts RPC Worker only; no Google/email provider calls.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chromium \
//   node cloudflare/signin-ui-smoke.mjs /path/to/report-directory
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {buildWeeklyDigest,buildPracticeNotice} from './emails.js';
const base = new URL(process.env.SMOKE_URL || 'http://localhost:8792');
if (!['localhost','127.0.0.1'].includes(base.hostname) || base.username || base.password) throw Error('Disposable localhost Worker only');
const origin = base.origin;
const accounts = new URL(process.env.SMOKE_ACCOUNTS_URL || 'http://localhost:8793');
if (!['localhost','127.0.0.1'].includes(accounts.hostname) || accounts.username || accounts.password) throw Error('Local fake Accounts only');
if (!process.argv[2]) throw Error('Pass a report directory as argv[2]');
const out = resolve(process.argv[2]);
await mkdir(out,{recursive:true});
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--no-proxy-server']});
const viewports = [{width:1440,height:1000},{width:390,height:844}];
const screenshots = [], errors = [], external = [], csp = [], families = [], contexts = [], identities = [];
const cleanupErrors = [];
const pin = '2468', run = crypto.randomUUID();
let assertions = 0, failure;
const check = (value,message) => {assert.ok(value,message); assertions++;};
async function api(context,path,data,code='') {
  const response = await context.request.fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{'X-Family-Code':code,...(data===undefined?{}:{Origin:origin})},...(data===undefined?{}:{data})});
  const body = await response.json();
  assert.ok(response.ok(),`${path}: ${response.status()} ${JSON.stringify(body)}`);
  return body;
}
async function contextFor(viewport,label) {
  const context = await browser.newContext({viewport,isMobile:viewport.width<600,hasTouch:viewport.width<600,reducedMotion:'reduce',serviceWorkers:'block',extraHTTPHeaders:{'CF-Connecting-IP':`198.19.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*254)+1}`}});
  contexts.push(context);
  await context.addInitScript(() => {
    if (location.protocol.startsWith('http')) localStorage.setItem('family-practice-device',JSON.stringify({keySounds:false,haptics:false,keyboard:'auto'}));
    document.addEventListener('securitypolicyviolation',e => {window.__smokeCsp ||= [];window.__smokeCsp.push({directive:e.effectiveDirective,blocked:e.blockedURI});});
  });
  await context.route('**/*',async route => {
    const url = new URL(route.request().url());
    if (['http:','https:'].includes(url.protocol) && ![origin,accounts.origin].includes(url.origin)) {external.push(`${label}: ${url.href}`);return route.abort();}
    return route.continue();
  });
  context.on('page',page => {
    page.setDefaultTimeout(15000);
    page.on('pageerror',error=>errors.push(`${label}: ${error.message}`));
  });
  return context;
}
async function shot(page,label,dialog=false) {
  if (!label.startsWith('email-preferences-saved')) await page.locator('#toast').waitFor({state:'hidden'});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: no horizontal overflow`);
  const bounds = await page.locator('dialog[open]').evaluateAll(ds=>ds.map(d=>{
    const r=d.getBoundingClientRect();
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,actions:[...d.querySelectorAll('.form-actions button')].filter(b=>!b.hidden).map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom};})};
  }));
  if(dialog)check(bounds.length===1,`${label}: one open dialog`);
  for(const d of bounds) {
    check(d.left>=0 && d.right<=page.viewportSize().width+1 && d.top>=0 && d.bottom<=page.viewportSize().height+1,`${label}: dialog fits viewport`);
    for(const b of d.actions)check(b.left>=0 && b.right<=page.viewportSize().width+1 && b.top>=0 && b.bottom<=page.viewportSize().height+1,`${label}: ${b.text} visible`);
  }
  csp.push(...await page.evaluate(()=>window.__smokeCsp || []));
  await page.screenshot({path:join(out,label+'.png'),fullPage:!dialog && !label.startsWith('email-preferences-saved')});screenshots.push(label+'.png');
}
async function manage(page) {
  await page.locator('header').getByRole('button',{name:'Parent mode',exact:true}).click();
  if (!await page.locator('.parent-more').evaluate(e => e.open)) await page.locator('.parent-more > summary').click();
  await page.getByRole('navigation',{name:'Parent sections'}).getByRole('button',{name:/^(Parent sign-in|Sign-in & email)$/}).click();
  await page.getByRole('heading',{name:'Parents linked to this family',exact:true}).waitFor();
}
async function signin(page,context,email,label) {
  const dialog=page.getByRole('dialog',{name:'Parent sign-in',exact:true});
  await dialog.getByLabel('Parent email',{exact:true}).fill(email);
  check(await dialog.getByRole('button',{name:'Continue with Google',exact:true}).isVisible(),'Google available through local Accounts');
  await shot(page,`email-signin-${label}`,true);
  await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
  await dialog.getByRole('button',{name:'Verify & sign in',exact:true}).waitFor();
  const code='123456';
  await shot(page,`email-code-${label}`,true);
  await dialog.getByLabel('Email code',{exact:true}).fill(code);
  const returned=page.waitForEvent('framenavigated',frame=>frame===page.mainFrame() && new URL(frame.url()).origin===origin);
  await dialog.getByRole('button',{name:'Verify & sign in',exact:true}).click();
  await returned;
  await page.waitForLoadState('networkidle');
  check((await api(context,'/api/auth/session')).signedIn,'real signed-in account session');
}
try {
  for(const viewport of viewports) {
    const size=`${viewport.width}x${viewport.height}`;
    const context=await contextFor(viewport,size), page=await context.newPage();
    const email=`signin-ui-${size}-${run}@example.com`;
    identities.push({context,email});
    check((await context.request.get(accounts.origin+'/health')).ok(),'local fake Accounts available');
    check((await api(context,'/api/auth/config')).email,'email enabled through local Accounts');
    await page.goto(origin);
    await page.getByRole('heading',{name:'Parent sign-in (optional)',exact:true}).waitFor();
    await shot(page,`landing-${size}`);
    await page.getByRole('button',{name:'Sign in with Jesklabs',exact:true}).click();
    await page.getByRole('dialog',{name:'Parent sign-in',exact:true}).waitFor();
    const unlinkedEmail='unlinked-'+email;
    identities.push({context,email:unlinkedEmail});
    await signin(page,context,unlinkedEmail,`unlinked-${size}`);
    await page.getByText('No linked families yet.',{exact:false}).waitFor();
    check((await api(context,'/api/auth/session')).families.length===0,'first sign-in has no family');
    await shot(page,`no-linked-family-${size}`);
    await api(context,'/api/auth/signout',{});
    await page.goto(accounts.origin+'/sso/logout?client=spelling&return=/');
    await page.getByRole('heading',{name:'Parent sign-in (optional)',exact:true}).waitFor();
    const family={context,name:`UI sign-in garden ${size}`,code:''};
    family.code=(await api(context,'/api/families',{name:family.name,pin,smoke:true})).code;families.push(family);
    // Real code join and PIN unlock before linking: neither family auth nor identity is mocked.
    await api(context,'/api/parent/lock',{},family.code);
    await page.getByLabel('Family code',{exact:true}).fill(family.code);
    await page.getByRole('button',{name:'Join family',exact:true}).click();
    await page.locator('header').getByRole('button',{name:'Parent mode',exact:true}).click();
    await page.getByLabel('Parent PIN',{exact:true}).fill(pin);
    await page.getByRole('button',{name:'Unlock',exact:true}).click();
    if (!await page.locator('.parent-more').evaluate(e => e.open)) await page.locator('.parent-more > summary').click();
  await page.getByRole('navigation',{name:'Parent sections'}).getByRole('button',{name:/^(Parent sign-in|Sign-in & email)$/}).click();
    await page.getByRole('button',{name:'Link Jesklabs sign-in',exact:true}).waitFor();
    await shot(page,`pin-parent-link-${size}`);
    await page.getByRole('button',{name:'Link Jesklabs sign-in',exact:true}).click();
    await signin(page,context,email,`link-${size}`);
    await manage(page);
    await page.getByRole('button',{name:'Save email preferences',exact:true}).waitFor();
    check((await api(context,'/api/auth/session')).families.length===1,'PIN-unlocked email link persists');
    check(await page.locator('.identity-block h2').allTextContents().then(h => JSON.stringify(h) === JSON.stringify(['Your sign-in','Parents linked to this family','Email reminders'])),'three clear identity blocks');
    check(!await page.getByRole('button',{name:'Recover family codes',exact:true}).count(),'recovery is outside identity settings');
    check(!await page.locator('#app').evaluate(e => /\b(null|undefined)\b/.test(e.innerText)),'no null or undefined rendered');
    await shot(page,`parent-signin-email-${size}`);
    await page.getByLabel('Weekly practice summary',{exact:true}).check();
    await page.getByLabel('Time zone',{exact:true}).fill('UTC');
    await page.getByRole('button',{name:'Save email preferences',exact:true}).click();
    await page.getByText('Email preferences saved.',{exact:true}).waitFor();
    check(await page.evaluate(() => {
      const toast = document.querySelector('#toast').getBoundingClientRect(), active = document.querySelector('#identity-timezone').closest('form').querySelector('[type=submit]').getBoundingClientRect();
      return toast.bottom <= innerHeight - 15 && (active.bottom <= toast.top || active.top >= toast.bottom);
    }), 'saved toast stays above safe area and clear of active control');
    await shot(page,`email-preferences-saved-${size}`);
    check((await api(context,'/api/auth/session')).prefs.weekly===true,'opt-in saved by real preferences API');
    await api(context,'/api/auth/signout',{});
    await page.goto(accounts.origin+'/sso/logout?client=spelling&return=/');
    await page.getByRole('button',{name:'Unlock Parent mode',exact:true}).waitFor();
    check(!(await api(context,'/api/auth/session')).signedIn,'local signout clears account');
    await page.getByRole('button',{name:'Unlock Parent mode',exact:true}).click();
    await page.getByLabel('Parent PIN',{exact:true}).fill(pin);
    await page.getByRole('button',{name:'Unlock',exact:true}).click();
    await page.getByRole('navigation',{name:'Parent sections'}).getByRole('button',{name:'Family',exact:true}).click();
    await page.getByRole('button',{name:'Recover family codes',exact:true}).click();
    await signin(page,context,email,`family-recovery-${size}`);
    const familyRecovery=page.getByRole('dialog',{name:'Recover family codes',exact:true});
    await familyRecovery.getByText(family.code,{exact:true}).waitFor();
    check(await familyRecovery.isVisible(),'Family recovery continues through signed-out email sign-in');
    await shot(page,`family-section-recovery-${size}`,true);
    await familyRecovery.getByRole('button',{name:'Close',exact:true}).click();
    const fresh=await contextFor(viewport,`new-device-${size}`), freshPage=await fresh.newPage();
    identities.push({context:fresh,email});
    await freshPage.goto(origin);
    check(await freshPage.evaluate(()=>!localStorage.getItem('family-practice-code')),'new device starts without saved family');
    await freshPage.getByRole('button',{name:'Sign in with Jesklabs',exact:true}).click();
    await freshPage.getByRole('dialog',{name:'Parent sign-in',exact:true}).waitFor();
    await signin(freshPage,fresh,email,`new-device-${size}`);
    await freshPage.getByRole('button',{name:'Manage family & settings',exact:true}).waitFor();
    check(await freshPage.evaluate(()=>localStorage.getItem('family-practice-code'))===family.code,'single linked family automatically opens on fresh device');
    check((await api(fresh,'/api/state',undefined,family.code)).parent,'account grants parent access without PIN on new device');
    await shot(freshPage,`new-device-auto-open-${size}`);
    const second={context:fresh,name:`UI sign-in meadow ${size}`,code:''};
    second.code=(await api(fresh,'/api/families',{name:second.name,pin,smoke:true})).code;families.push(second);
    await api(fresh,'/api/auth/link',{familyCode:second.code},second.code);
    await freshPage.reload();
    await freshPage.getByRole('button',{name:'Choose another family',exact:true}).click();
    for(const f of [family,second])await freshPage.getByRole('button',{name:'Open '+f.name,exact:true}).waitFor();
    check((await api(fresh,'/api/auth/session')).families.length===2,'two linked families available');
    await shot(freshPage,`family-picker-${size}`);
    await freshPage.getByRole('button',{name:'Recover family codes',exact:true}).click();
    const recovery=freshPage.getByRole('dialog',{name:'Recover family codes',exact:true});
    for(const f of [family,second]) {
      await recovery.getByText(f.code,{exact:true}).waitFor();
      check(await recovery.getByText(f.code,{exact:true}).isVisible(),'recovery shows linked family code');
    }
    check(await recovery.locator('.identity-actions').evaluateAll(rows => rows.every(row => {const [a,b] = [...row.querySelectorAll('button')].map(e => e.getBoundingClientRect()); return Math.abs(a.width-b.width)<1;})), 'recovery actions have equal widths');
    check(await recovery.locator('.recovery-code').evaluateAll(codes => codes.every(e => e.scrollWidth <= e.clientWidth)), 'family codes fit without breaking words');
    await shot(freshPage,`recover-codes-${size}`,true);
    await recovery.getByRole('button',{name:'Close',exact:true}).click();
    await freshPage.getByRole('button',{name:'Open '+second.name,exact:true}).click();
    await freshPage.getByRole('button',{name:'Manage family & settings',exact:true}).waitFor();
    check(await freshPage.evaluate(()=>localStorage.getItem('family-practice-code'))===second.code,'picker opens selected second family');
    await manage(freshPage);
    await shot(freshPage,`two-family-parent-signin-${size}`);
    freshPage.on('dialog',dialog=>dialog.accept());
    await freshPage.getByRole('button',{name:'Unlink parent',exact:true}).click();
    await freshPage.getByText('No parent sign-ins linked yet.',{exact:true}).waitFor();
    check((await api(fresh,'/api/auth/recover')).families.length===1,'UI unlink revokes only selected family');
    await shot(freshPage,`parent-unlinked-${size}`);
    await freshPage.getByRole('button',{name:'Delete my sign-in',exact:true}).click();
    await freshPage.getByRole('button',{name:'Unlock Parent mode',exact:true}).waitFor();
    check(!(await api(fresh,'/api/auth/session')).signedIn,'UI delete clears app account');
    await shot(freshPage,`parent-signin-deleted-${size}`);
    // Real top-level local Accounts Google/SSO hops; no auth response mocks.
    const shared=await contextFor(viewport,`google-sso-${size}`), sharedPage=await shared.newPage();
    identities.push({context:shared,email:'google-local@example.com'});
    await sharedPage.goto(origin);
    await sharedPage.getByRole('button',{name:'Sign in with Jesklabs',exact:true}).click();
    await sharedPage.getByRole('dialog',{name:'Parent sign-in',exact:true}).getByRole('button',{name:'Continue with Google',exact:true}).click();
    await sharedPage.getByText('No linked families yet.',{exact:false}).waitFor();
    check((await api(shared,'/api/auth/session')).signedIn,'Google callback establishes real app session');
    await shot(sharedPage,`google-signed-in-${size}`);
    await api(shared,'/api/auth/signout',{}); // Preserve shared SSO to exercise consent.
    await sharedPage.goto(origin);
    await sharedPage.getByRole('button',{name:'Sign in with Jesklabs',exact:true}).click();
    const consent=sharedPage.getByRole('dialog',{name:'Continue with Jesklabs?',exact:true});
    await consent.waitFor();
    check(!(await api(shared,'/api/auth/session')).signedIn,'shared SSO alone does not create app session');
    await shot(sharedPage,`sso-consent-${size}`,true);
    await consent.getByRole('button',{name:'Use a different account',exact:true}).click();
    await sharedPage.getByRole('dialog',{name:'Parent sign-in',exact:true}).waitFor();
    check(!(await api(shared,'/api/auth/session')).signedIn,'declining SSO does not create app session');
    await shot(sharedPage,`sso-declined-${size}`,true);
    await sharedPage.goto(origin);
    await sharedPage.getByRole('button',{name:'Sign in with Jesklabs',exact:true}).click();
    await sharedPage.getByRole('dialog',{name:'Continue with Jesklabs?',exact:true}).waitFor();
    check(!!(await api(shared,'/api/auth/pending')).email,'second consent has a live pending identity');
    await sharedPage.getByRole('dialog',{name:'Continue with Jesklabs?',exact:true}).getByRole('button',{name:/^Continue as /}).click();
    await sharedPage.getByText('No linked families yet.',{exact:false}).waitFor();
    check((await api(shared,'/api/auth/session')).signedIn,'explicit SSO consent creates app session');
    await shot(sharedPage,`sso-confirmed-${size}`);
    await api(shared,'/api/auth/delete',{});
    const digest=buildWeeklyDigest({familyName:'The Sample Family',kids:[{name:'Sam',attempts:42,accuracy:88,practiceDays:4,streak:4,dueWords:6,lists:['Kind words'],trickyWords:['friend','beautiful'],verseStarsChange:2},{name:'Alex',attempts:28,accuracy:93,practiceDays:3,streak:3,dueWords:4}],practiceUrl:origin+'/',unsubscribe:origin+'/unsubscribe/sample-preview'});
    check(!digest.text.includes(family.code) && !digest.text.includes(email),'digest sample excludes live fixture identifiers');
    const examples = {'weekly-email': digest, 'class-update-email': buildPracticeNotice({kind:'classUpdates',familyName:'The Sample Family',practiceUrl:origin+'/',unsubscribe:origin+'/unsubscribe/sample-preview'}), 'review-nudge-email': buildPracticeNotice({kind:'review',familyName:'The Sample Family',dueWords:10,practiceUrl:origin+'/',unsubscribe:origin+'/unsubscribe/sample-preview'})};
    for (const [label, message] of Object.entries(examples)) {
      await writeFile(join(out,`${label}-${size}.html`),message.html);
      const mail=await fresh.newPage();
      await mail.setContent(message.html);
      await mail.getByRole('heading',{name:label==='weekly-email'?'Sam':label==='signin-code-email'?'Your sign-in code':message.subject,exact:true}).waitFor();
      await shot(mail,`${label}-${size}`);
    }
  }
  check(errors.length===0,`browser JS errors: ${JSON.stringify(errors)}`);
  check(external.length===0,`external requests blocked before network: ${JSON.stringify(external)}`);
  check(csp.length===0,`CSP violations: ${JSON.stringify(csp)}`);
} catch(error) {
  failure=error.stack;
  for(const [i,context] of contexts.entries())for(const [j,page] of context.pages().entries())await page.screenshot({path:join(out,`failure-${i}-${j}.png`),fullPage:true}).catch(()=>{});
} finally {
  // Cleanup goes through real Accounts RPC, never an application test endpoint.
  for(const {context,email} of [...new Map(identities.map(i=>[i.email,i])).values()])try {
    await api(context,'/api/auth/code/send',{email});
    await api(context,'/api/auth/code/verify',{email,code:'123456'});
    await api(context,'/api/auth/delete',{});
  } catch(error) {cleanupErrors.push(error.message);}
  const cleaner=await browser.newContext();
  for(const family of families)try {
    await api(cleaner,'/api/parent/unlock',{pin},family.code);
    await api(cleaner,'/api/admin/delete-family',{pin,confirmation:family.name},family.code);
  } catch(error) {cleanupErrors.push(error.message);}
  await browser.close();
  await writeFile(join(out,'signin-ui-report.json'),JSON.stringify({passed:!failure && !cleanupErrors.length,viewports,assertions,screenshots,errors,external,csp,accountsBackend:'local-fake-SpellingClient',googleProvider:'local-fake',cleanup:{families:families.length,errors:cleanupErrors},...(failure?{failure}:{})},null,2));
}
if(failure)throw Error(failure);
assert.deepEqual(cleanupErrors,[],'disposable local identity/family cleanup');
console.log(`PASS: ${assertions} assertions; ${screenshots.length} screenshots, desktop + 390x844, real local Accounts RPC email + Google auth, SSO confirm/decline, PIN linking, new-device auto-open, family picker/recovery, preferences, unlink and delete. All disposable identities/families deleted. Reports: ${out}`);
