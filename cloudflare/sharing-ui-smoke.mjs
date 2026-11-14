// Disposable localhost only. Run after /tmp/fp-sharing-ready exists and Wrangler is listening.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chromium node cloudflare/sharing-ui-smoke.mjs [screenshot-dir]
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = new URL(process.env.SMOKE_URL || 'http://localhost:8792').origin;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw Error('Use disposable localhost only');
const out = process.argv[2] || '.tools/sharing-screens';
await mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH || undefined, args:['--no-sandbox']});
const errors = [], external = [], csp = [], screenshots = [], families = [];
const pin = '2468', title = 'Kind words for the week', className = 'Weekly word garden';
const suiteOctet=Math.floor(Math.random()*256);
const viewports = [{width:1440,height:1000},{width:390,height:844}];
let assertions = 0;
function check(value, message) {assert.ok(value,message);assertions++;}
async function api(family, path, data, method = data === undefined ? 'GET' : 'POST') {
  const response = await family.context.request.fetch(origin+path,{method,headers:{'X-Family-Code':family.code || ''},...(data === undefined ? {} : {data})});
  const body = await response.json();
  assert.ok(response.ok(),`${method} ${path}: ${response.status()} ${JSON.stringify(body)}`);
  return body;
}
async function contextFor(viewport, label) {
  const context = await browser.newContext({viewport,isMobile:viewport.width<600,hasTouch:viewport.width<600,reducedMotion:'reduce',serviceWorkers:'block',extraHTTPHeaders:{'CF-Connecting-IP':`198.19.${suiteOctet}.${20+families.length}`}});
  await context.addInitScript(() => {
    if(location.protocol==='http:' || location.protocol==='https:')localStorage.setItem('family-practice-device',JSON.stringify({keySounds:false,haptics:false,keyboard:'auto'}));
    document.addEventListener('securitypolicyviolation',e => {window.__smokeCsp ||= [];window.__smokeCsp.push({directive:e.effectiveDirective,blocked:e.blockedURI});});
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:','https:'].includes(url.protocol) && url.origin !== origin) {external.push(`${label}: ${url.href}`);await route.abort();}
    else await route.continue();
  });
  context.on('page',page => {
    page.setDefaultTimeout(15000);
    page.on('pageerror',error=>errors.push(`${label}: ${error.message}`));
    page.on('console',message=>{if(message.type()==='error' && /Content Security Policy|Refused to (execute|load|apply)|violates.*directive/i.test(message.text()))csp.push(`${label}: ${message.text()}`);});
  });
  return context;
}
async function familyFixture(viewport, label, kidNames) {
  const context = await contextFor(viewport,label);
  const family = {context,code:'',name:`Sharing UI ${label} ${Date.now()}`};
  families.push(family);
  family.code = (await api(family,'/api/families',{name:family.name,pin})).code;
  await api(family,'/api/parent/unlock',{pin});
  for (const name of kidNames) await api(family,'/api/admin/kids',{name});
  family.kids = (await api(family,'/api/state')).kids;
  await context.addInitScript(code => {if(location.protocol==='http:' || location.protocol==='https:')localStorage.setItem('family-practice-code',code);},family.code);
  return family;
}
async function shot(page, label, dialog = false) {
  check(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),`${label}: no page overflow`);
  const geometry = await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map(d=>{
    const r=d.getBoundingClientRect();
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,actions:[...d.querySelectorAll('.form-actions button')].map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom};})};
  }));
  if(dialog)check(geometry.length===1,`${label}: one open sheet`);
  for(const d of geometry){
    check(d.left>=0 && d.right<=page.viewportSize().width+1,`${label}: sheet fits width`);
    for(const b of d.actions)check(b.left>=0 && b.right<=page.viewportSize().width+1 && b.top>=0 && b.bottom<=page.viewportSize().height+1,`${label}: ${b.text} action visible without scrolling`);
  }
  csp.push(...await page.evaluate(()=>window.__smokeCsp || []));
  await page.screenshot({path:`${out}/${label}.png`,fullPage:!dialog});
  screenshots.push(label);
}
async function goto(page,path,publicPage=false) {
  const response = await page.goto(origin+path);
  check(response.ok(),`${path}: shell loads`);
  const policy = response.headers()['content-security-policy'];
  for(const directive of ["default-src 'self'","script-src 'self'","connect-src 'self'","object-src 'none'","frame-ancestors 'none'"])check(policy?.includes(directive),`${path}: CSP ${directive}`);
  check(!/script-src[^;]*'unsafe-(inline|eval)'/.test(policy),`${path}: no unsafe scripts`);
  if(publicPage){
    check(response.headers()['x-robots-tag']?.includes('noindex'),`${path}: noindex response header`);
    check((await page.locator('meta[name=robots]').getAttribute('content'))?.includes('noindex'),`${path}: noindex HTML`);
  }
}
async function parent(page) {
  await page.locator('header').getByRole('button',{name:'Parent mode',exact:true}).click();
  await page.getByRole('button',{name:'Done',exact:true}).waitFor();
}
async function closeSheet(page) {await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();}
async function pickKids(page,names,withVerse=true) {
  const dialog=page.getByRole('dialog');
  for(const name of names)await dialog.getByLabel(name,{exact:true}).check();
  if(withVerse)await dialog.getByLabel('Include Bible verse when available',{exact:true}).check();
}
try {
  for(const viewport of viewports){
    const size=`${viewport.width}x${viewport.height}`;
    const owner=await familyFixture(viewport,`owner-${size}`,['Publisher']);
    const follower=await familyFixture(viewport,`follower-${size}`,['Reader','Explorer']);
    const list=await api(owner,'/api/admin/lists',{kid_id:owner.kids[0].id,title,date:'2026-11-16',words:[{word:'friend',sentence:'A friend is kind.'},{word:'light',sentence:'The light is bright.'},{word:'garden',sentence:'We water the garden.'}]});
    await api(owner,'/api/admin/verses',{kid_id:owner.kids[0].id,reference:'John 11:35',text:'Jesus wept.',translation:'KJV'});
    const page=await owner.context.newPage();
    await goto(page,'/');
    await page.getByRole('button',{name:'Publisher',exact:false}).click();
    await parent(page);
    await page.getByRole('navigation',{name:'Parent sections'}).getByRole('button',{name:'Spelling lists',exact:true}).click();
    const row=page.getByText(title,{exact:true}).locator('xpath=ancestor::*[.//button[normalize-space()="Share"]][1]');
    await row.getByRole('button',{name:'Share',exact:true}).click();
    await page.getByLabel('Note (optional, 140 characters)',{exact:true}).fill('Practice a little each day.');
    await page.getByLabel('Include a Bible verse (optional)',{exact:true}).selectOption({label:'John 11:35'});
    await shot(page,`share-sheet-${size}`,true);
    await page.getByRole('button',{name:'Create share link',exact:true}).click();
    const link=page.getByLabel('Public sharing link',{exact:true});await link.waitFor();
    const shareURL=await link.inputValue();
    check(new URL(shareURL).origin===origin && new URL(shareURL).pathname.startsWith('/s/'),'share URL is first-party public snapshot');
    check(!shareURL.includes(owner.code),'share URL excludes family code');
    check(await page.getByRole('img',{name:'QR code for this link'}).locator('svg').count()===1,'Share sheet renders local SVG QR');
    await shot(page,`share-qr-${size}`,true);
    await closeSheet(page);
    await page.getByRole('navigation',{name:'Parent sections'}).getByRole('button',{name:'Class lists',exact:true}).click();
    await page.getByRole('button',{name:'+ Create class list',exact:true}).click();
    await page.getByLabel('Class list name',{exact:true}).fill(className);
    await page.getByRole('dialog').getByRole('button',{name:'Create',exact:true}).click();
    await page.getByRole('heading',{name:className,exact:true}).waitFor();
    await page.getByRole('button',{name:'Publish week',exact:true}).click();
    await page.getByLabel('Spelling list',{exact:true}).selectOption(String(list.id));
    await page.getByLabel('Optional Bible verse',{exact:true}).selectOption({label:'John 11:35'});
    await shot(page,`class-publish-sheet-${size}`,true);
    await page.getByRole('dialog').getByRole('button',{name:'Publish week',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Link & QR',exact:true}).click();
    const classURL=await page.getByLabel('Public sharing link',{exact:true}).inputValue();
    check(new URL(classURL).pathname.startsWith('/c/'),'class URL uses public class route');
    await shot(page,`class-qr-${size}`,true);await closeSheet(page);
    await shot(page,`class-admin-${size}`);
    const anonymous=await contextFor(viewport,`anonymous-${size}`);
    const publicView=await anonymous.newPage();
    const publicReads=[];
    publicView.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))publicReads.push({url:request.url(),headers:request.headers()});});
    await goto(publicView,new URL(shareURL).pathname,true);
    await publicView.getByRole('heading',{name:title,exact:true}).waitFor();
    await publicView.getByText('A friend is kind.',{exact:true}).waitFor();
    await publicView.getByText('Jesus wept.',{exact:true}).waitFor();
    check(!(await publicView.locator('#app').innerText()).includes('Publisher'),'public preview omits owner kid name');
    await shot(publicView,`public-share-${size}`);
    await goto(publicView,new URL(classURL).pathname,true);
    await publicView.getByRole('heading',{name:className,exact:true}).waitFor();
    await publicView.getByRole('heading',{name:title,exact:true}).waitFor();
    await shot(publicView,`public-class-${size}`);
    check(publicReads.length>=2 && publicReads.every(r=>!r.headers['x-family-code'] && !r.headers.cookie),'anonymous previews never send family credentials');
    await anonymous.close();
    const reader=await follower.context.newPage();
    const signedInPublicReads=[];
    reader.on('request',request=>{if (/^\/api\/(share|class)\//.test(new URL(request.url()).pathname))signedInPublicReads.push(request.headers());});
    await goto(reader,new URL(shareURL).pathname,true);
    await reader.getByRole('button',{name:'Add to my family',exact:true}).click();
    await pickKids(reader,['Reader','Explorer']);
    await shot(reader,`multi-kid-import-${size}`,true);
    await reader.getByRole('dialog').getByRole('button',{name:'Add to family',exact:true}).click();
    await reader.getByRole('dialog').waitFor({state:'hidden'});
    for(const k of follower.kids){
      const copied=await api(follower,`/api/state?kid=${k.id}`);
      check(copied.lists.some(l=>l.title===title && l.words.some(w=>w.word==='friend')),`${k.name}: snapshot words imported`);
      check(copied.verses.some(v=>v.reference==='John 11:35'),`${k.name}: optional verse imported`);
    }
    await goto(reader,new URL(classURL).pathname,true);
    await reader.getByRole('button',{name:'Follow class list',exact:true}).click();
    check(signedInPublicReads.length>=2 && signedInPublicReads.every(h=>!h['x-family-code'] && !h.cookie),'signed-in public previews omit family code and parent cookie');
    await pickKids(reader,['Reader','Explorer']);
    await reader.getByRole('dialog').getByRole('button',{name:'Save following',exact:true}).click();
    await reader.getByRole('dialog').waitFor({state:'hidden'});
    // Follow an already-published, not-yet-imported class week. This uses real
    // ready-card data without bypassing the ten-minute publish restriction.
    await api(follower,'/api/parent/lock',{});
    await goto(reader,'/');
    await reader.getByRole('button',{name:'Reader',exact:false}).click();
    await reader.getByRole('heading',{name:'New week from your class',exact:true}).waitFor();
    await shot(reader,`new-week-locked-${size}`);
    const before=(await api(follower,`/api/state?kid=${follower.kids[0].id}`)).lists.length;
    await reader.getByRole('button',{name:'Add for Reader',exact:true}).click();
    await reader.getByLabel('Parent PIN',{exact:true}).waitFor();
    check((await api(follower,`/api/state?kid=${follower.kids[0].id}`)).lists.length===before,'locked ready-card click does not import');
    await shot(reader,`new-week-parent-unlock-${size}`,true);
    await reader.getByLabel('Parent PIN',{exact:true}).fill(pin);
    await reader.getByRole('button',{name:'Unlock',exact:true}).click();
    await reader.getByRole('dialog').getByRole('button',{name:'Add to family',exact:true}).waitFor();
    check(await reader.getByRole('dialog').getByLabel('Reader',{exact:true}).isChecked(),'ready-card picker preselects current kid after unlock');
    await reader.getByRole('dialog').getByRole('button',{name:'Add to family',exact:true}).click();
    await reader.getByRole('dialog').waitFor({state:'hidden'});
    check((await api(follower,`/api/state?kid=${follower.kids[0].id}`)).lists.length===before+1,'parent-unlocked ready card imports independent class copy');
    await reader.getByRole('heading',{name:'New week from your class',exact:true}).waitFor({state:'hidden'});
    await shot(reader,`new-week-imported-${size}`);
    const freshContext=await contextFor(viewport,`new-family-${size}`);
    const freshPage=await freshContext.newPage();
    await goto(freshPage,new URL(shareURL).pathname,true);
    await freshPage.getByRole('button',{name:'Add to my family',exact:true}).click();
    await freshPage.getByRole('button',{name:'Create a new family',exact:true}).click();
    const freshName=`Sharing onboarding ${size} ${Date.now()}`;
    await freshPage.getByLabel('Family name (optional)',{exact:true}).fill(freshName);
    await freshPage.getByLabel('Parent PIN (4–8 digits)',{exact:true}).fill(pin);
    await freshPage.getByLabel('Repeat PIN',{exact:true}).fill(pin);
    await freshPage.getByRole('button',{name:'Create & continue',exact:true}).click();
    await freshPage.getByRole('dialog',{name:'Keep your family code',exact:true}).waitFor();
    const fresh={context:freshContext,code:await freshPage.evaluate(()=>localStorage.getItem('family-practice-code')),name:freshName};families.push(fresh);
    check(!!fresh.code,'new family saves its code before continuing import');
    await shot(freshPage,`new-family-code-${size}`,true);
    await freshPage.getByRole('button',{name:'Continue to add the list',exact:true}).click();
    await freshPage.getByLabel('Add your first kid',{exact:true}).fill('New reader');
    await freshPage.getByLabel('Include Bible verse when available',{exact:true}).check();
    await shot(freshPage,`new-family-import-${size}`,true);
    await freshPage.getByRole('button',{name:'Add to family',exact:true}).click();
    await freshPage.getByRole('dialog').waitFor({state:'hidden'});
    const freshState=await api(fresh,'/api/state?kid=1');
    check(freshState.lists.some(l=>l.title===title),'new family creation resumes original shared-list import');
    check(freshState.verses.some(v=>v.reference==='John 11:35'),'new family import retains selected verse');
    for(const ctx of [owner.context,follower.context])for(const p of ctx.pages())csp.push(...await p.evaluate(()=>window.__smokeCsp || []));
  }
  assert.deepEqual(errors,[],'no browser JavaScript errors');
  assert.deepEqual(external,[],'no third-party browser requests (also blocked before network)');
  assert.deepEqual(csp,[],'no browser CSP violations');
  await writeFile(`${out}/sharing-ui-report.json`,JSON.stringify({viewports,assertions,screenshots,errors,external,csp},null,2));
  console.log(`PASS: ${assertions} assertions; desktop + 390x844 Share/QR, public previews, class creation/publish, two-kid verse import, follow and locked new-week import. Screenshots: ${out}`);
} catch(error) {
  for(const [index,family] of families.entries())for(const [pageIndex,page] of family.context.pages().entries()){
    await page.screenshot({path:`${out}/failure-${index}-${pageIndex}.png`,fullPage:true}).catch(()=>{});
  }
  await writeFile(`${out}/sharing-ui-report.json`,JSON.stringify({viewports,assertions,screenshots,errors,external,csp,failure:error.message},null,2));
  throw error;
} finally {
  const cleanupErrors=[];
  for(const family of families)if(family.code){
    try{await api(family,'/api/parent/unlock',{pin});await api(family,'/api/admin/delete-family',{pin,confirmation:family.name});}
    catch(error){cleanupErrors.push(error.message);}
  }
  await browser.close();
  assert.deepEqual(cleanupErrors,[],'all disposable local families deleted');
}
