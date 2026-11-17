// Optional Playwright tooling only. Disposable localhost data; no production writes.
// Usage: node cloudflare/srs-screens.mjs [output-directory]
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin=process.env.SMOKE_URL || 'http://localhost:8792';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw Error('Use disposable localhost only');
const out=resolve(process.argv[2] || '.tools/srs-screens');
await mkdir(out,{recursive:true});
const tinyMP3=Buffer.from('//NExAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExFMAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKYAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NExKwAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NExKwAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV','base64');
const PIN='2468', errors=[], external=[];
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox']});
let code='',cookie='';
async function call(path,data) {
  const r=await fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{'X-Family-Code':code,cookie,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  const body=await r.json();assert.equal(r.ok,true,`${path}: ${JSON.stringify(body)}`);return body;
}
async function seed() {
  code=(await call('/api/families',{name:'SRS screenshot fixture',pin:PIN,smoke:true})).code;
  await call('/api/parent/unlock',{pin:PIN});
  await call('/api/admin/kids',{name:'Sam',grade:'2'});
  const kid=(await call('/api/state')).kids[0];
  await call('/api/admin/lists',{kid_id:kid.id,title:'This week’s words',date:new Date().toISOString().slice(0,10),words:[
    {word:'beautiful',sentence:'The garden is beautiful.'},{word:'friend',sentence:'My friend is kind.'},
    {word:'because',sentence:'We stayed inside because it rained.'},{word:'journey',sentence:'The journey took all afternoon.'},
    {word:'light',sentence:'Please turn on the light.'},{word:'cat',sentence:'The cat slept.'},
  ]});
  const list=(await call('/api/state?kid='+kid.id)).lists[0];
  // Different boxes and misses make the bank meaningful; age attempts through
  // the same backup/import contract parents use, which rebuilds derived SRS data.
  for(let round=0;round<4;round++) {
    const ws=list.words.filter((_,i)=>i<4 && (i!==1 || round===0) && (i!==2 || round<2));
    const session=await call('/api/sessions',{kid_id:kid.id,list_id:list.id,word_ids:ws.map(w=>w.id),kind:'spelling'});
    for(const w of ws) {
      await call('/api/attempts',{session_id:session.id,word_id:w.id,typed:w.word==='friend'?'frend':w.word});
      if(w.word==='friend')await call('/api/attempts',{session_id:session.id,word_id:w.id,typed:'frend'});
    }
    await call('/api/sessions/complete',{session_id:session.id});
  }
  const backup=await call('/api/admin/export');
  for(const row of [...backup.attempts,...backup.sessions])row.created_at=new Date(Date.now()-45*86400000).toISOString();
  delete backup.wordBank; // Rebuild from the deliberately aged history.
  await call('/api/admin/import',backup);
  const bank=await call('/api/review?kid='+kid.id);
  assert.ok(bank.due.length>0,'fixture has due reviews');
  assert.ok(bank.counts.learning && bank.counts.gettingIt && bank.counts.mastered,'fixture spans all word-bank groups');
  await call('/api/parent/lock',{});
}
async function shot(page,name,label,fullPage=false) {
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name}/${label}: no horizontal overflow`);
  await page.screenshot({path:resolve(out,`${name}-${label}.png`),fullPage});
  if(label==='mobile') {
    await page.setViewportSize({width:360,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name}: no horizontal overflow at 360px`);
    await page.setViewportSize({width:390,height:844});
  }
  console.log(`saved ${name}-${label}.png`);
}
try {
  await seed();
  for(const {label,...options} of [
    {label:'mobile',viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true},
    {label:'desktop',viewport:{width:1280,height:900},deviceScaleFactor:1},
  ]) {
    const context=await browser.newContext({...options,reducedMotion:'reduce'});
    await context.addInitScript(code=>{
      localStorage.setItem('family-practice-code',code);
      localStorage.setItem('family-practice-device',JSON.stringify({keySounds:false,haptics:false,keyboard:'auto'}));
      speechSynthesis.speak=u=>setTimeout(()=>u.onend?.(),10);speechSynthesis.cancel=()=>{};
    },code);
    const page=await context.newPage();page.setDefaultTimeout(10000);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(new URL(r.url()).origin!==origin)external.push(r.url());});
    page.on('dialog',d=>d.accept());
    await context.route('**/api/tts?*',route=>route.fulfill({status:200,contentType:'audio/mpeg',body:tinyMP3}));
    await page.goto(origin);
    await page.getByRole('button',{name:/Sam/}).click();
    await page.getByRole('button',{name:'Start review',exact:true}).waitFor();
    await shot(page,'01-review-entry',label,true);
    await page.getByRole('button',{name:'Learn',exact:true}).first().click();
    for(const [i,name] of ['Copy','Fade','Fade more','Recall'].entries()) {
      await page.getByText(`Stage ${i+1} of 4 · ${name}`,{exact:true}).waitFor();
      assert.equal(await page.locator('ol.learn-stages [aria-current=step]').count(),1);
      await shot(page,`0${i+2}-learn-${name.toLowerCase().replaceAll(' ','-')}`,label);
      if(i<3) {
        await page.getByLabel('Type the full word',{exact:true}).fill('beautiful');
        await page.getByRole('button',{name:'Check word'}).click();
        await page.getByRole('button',{name:'Continue',exact:true}).click();
      }
    }
    await page.getByRole('button',{name:'End learning',exact:true}).click();
    await page.getByRole('button',{name:'Progress',exact:true}).click();
    const bank=page.getByRole('heading',{name:'Word bank',level:2,exact:true});
    await bank.waitFor();
    await page.locator('.bank-counts').waitFor();
    await bank.evaluate(n=>n.closest('.section').scrollIntoView({block:'start'}));
    await shot(page,'06-word-bank',label);
    await shot(page,'07-progress-full',label,true);
    await context.close();
  }
  assert.deepEqual(errors,[],'no browser errors');assert.deepEqual(external,[],'no third-party requests');
  console.log(`PASS: Learn4 headers, due Review entry, and Word bank captured at 390×844 and 1280×900 in ${out}`);
} finally {
  if(code) {
    try {await call('/api/parent/unlock',{pin:PIN});await call('/api/admin/delete-family',{pin:PIN,confirmation:code});}
    catch(error){console.error('Disposable family cleanup failed:',error.message);process.exitCode=1;}
  }
  await browser.close();
}
