// Optional Playwright tool only; not an application/runtime dependency.
// Seeds a disposable demo family on a local Worker and captures the main screens
// at iPhone and desktop sizes. Usage: node cloudflare/screens.mjs <output-dir>
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin=process.env.SMOKE_URL || 'http://localhost:8792';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw Error('Use disposable localhost only');
const out=resolve(process.argv[2] || '.tools/screens');
await mkdir(out,{recursive:true});
// Five MPEG audio frames of silence, the same fixture as ui-smoke.mjs.
const tinyMP3=Buffer.from('//NExAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExFMAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKYAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NExKwAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NExKwAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV','base64');
const PIN='2468';
const THIS_WEEK=[
  ['beautiful','The garden is beautiful in the spring.'],['friend','My friend sat next to me at lunch.'],
  ['because','We stayed inside because it rained.'],['journey','The journey took all afternoon.'],
  ['light','Please turn on the light.'],['quiet','The library is quiet.'],
];
const LAST_WEEK=[['kind','Be kind to your brother.'],['said','Mom said it was time for bed.'],['again','Read the page again.'],['there','Put your shoes over there.'],['laugh','The joke made us laugh.'],['would','Would you like some soup?']];
const VERSE={reference:'Psalm 119:105',translation:'KJV',text:'Thy word is a lamp unto my feet, and a light unto my path.'};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox']});
const errors=[],external=[];
async function seed() {
  const page=await browser.newPage();
  await page.goto(origin+'/privacy');
  const code=await page.evaluate(async({PIN,THIS_WEEK,LAST_WEEK,VERSE})=>{
    let code='';
    const call=async(path,data)=>{
      const r=await fetch(path,{method:data===undefined?'GET':'POST',headers:{'X-Family-Code':code,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
      const body=await r.json();if(!r.ok)throw Error(path+': '+body.error);return body;
    };
    code=(await call('/api/families',{name:'The Hill family',pin:PIN})).code;
    await call('/api/parent/unlock',{pin:PIN});
    await call('/api/admin/kids',{name:'Sam',grade:'2'});
    await call('/api/admin/kids',{name:'Maya',grade:'4'});
    const kids=(await call('/api/state')).kids, sam=kids.find(k=>k.name==='Sam'), maya=kids.find(k=>k.name==='Maya');
    const list=(kid,title,date,words)=>call('/api/admin/lists',{kid_id:kid.id,title,date,words:words.map(([word,sentence])=>({word,sentence}))});
    const day=offset=>new Date(Date.now()-offset*86400000).toISOString().slice(0,10);
    await list(sam,'Week of Nov 3',day(9),LAST_WEEK);
    await list(sam,'Week of Nov 10',day(2),THIS_WEEK);
    await list(maya,'Week of Nov 10',day(2),[['through','We walked through the woods.'],['thought','I thought about it.']]);
    await call('/api/admin/verses',{kid_id:sam.id,...VERSE});
    const state=await call('/api/state?kid='+sam.id);
    const old=state.lists.find(l=>l.title==='Week of Nov 3'), current=state.lists.find(l=>l.title==='Week of Nov 10');
    // Last week's test: four first-try words, one retry win, one missed twice.
    const test=await call('/api/sessions',{kid_id:sam.id,list_id:old.id,word_ids:old.words.map(w=>w.id),kind:'spelling'});
    const typo={again:['agian','again'],would:['wood','wud']};
    for(const w of old.words) for(const typed of typo[w.word] || [w.word]) {
      const r=await call('/api/attempts',{session_id:test.id,word_id:w.id,typed});if(r.correct)break;
    }
    await call('/api/sessions/complete',{session_id:test.id});
    // This week: a short Learn round and a partial test.
    const learn=await call('/api/sessions',{kid_id:sam.id,list_id:current.id,word_ids:current.words.map(w=>w.id),kind:'learn'});
    for(const w of current.words.slice(0,3)) for(const step of [0,25,50]) await call('/api/attempts',{session_id:learn.id,word_id:w.id,typed:w.word,mode:'learn',step});
    const quiz=await call('/api/sessions',{kid_id:sam.id,list_id:current.id,word_ids:current.words.map(w=>w.id),kind:'spelling'});
    for(const w of current.words.slice(0,4)) await call('/api/attempts',{session_id:quiz.id,word_id:w.id,typed:w.word==='because'?'becuase':w.word});
    const verse=state.verses[0], words=VERSE.text.match(/[\p{L}]+/gu);
    const vs=await call('/api/sessions',{kid_id:sam.id,kind:'verse'});
    const indices=[1,3,8,11];
    await call('/api/verse-attempts',{session_id:vs.id,verse_id:verse.id,mode:'blanks',level:25,indices,typed:indices.map(i=>words[i]).join(' ')});
    await call('/api/verse-attempts',{session_id:vs.id,verse_id:verse.id,mode:'first',typed:'Thy word is a lamp unto my feet and a light to my path'});
    await call('/api/sessions/complete',{session_id:vs.id});
    await call('/api/parent/lock',{});
    return code;
  },{PIN,THIS_WEEK,LAST_WEEK,VERSE});
  await page.close();
  return code;
}
// Types with the on-screen keyboard when the app shows one, otherwise like a physical keyboard.
async function typeInto(page,field,text) {
  const keyboard=page.locator('[data-keyboard]:visible');
  if(await keyboard.count()) for(const ch of text) await keyboard.getByRole('button',{name:ch,exact:true}).click();
  else { await field.click(); await field.pressSequentially(text); }
}
async function settle(page) { await page.waitForTimeout(450); }
async function shot(page,name,label,full=false) {
  await settle(page);
  await page.evaluate(()=>{const t=document.getElementById('toast');if(t)t.style.display='none';});
  await page.screenshot({path:`${out}/${name}-${label}.png`,fullPage:full});
  console.log('saved',`${name}-${label}.png`);
}
const code=await seed();
const sizes=[{label:'mobile',viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true},{label:'desktop',viewport:{width:1280,height:800},deviceScaleFactor:1}];
try {
  for(const {label,...options} of sizes) {
    const context=await browser.newContext({...options,reducedMotion:'reduce'});
    const page=await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(new URL(r.url()).origin!==origin)external.push(r.url());});
    page.on('dialog',d=>d.accept());
    await context.route('**/api/tts?*',route=>route.fulfill({status:200,contentType:'audio/mpeg',body:tinyMP3}));
    await page.addInitScript(()=>{speechSynthesis.speak=u=>setTimeout(()=>u.onend?.(),10);speechSynthesis.cancel=()=>{};});
    await page.goto(origin);
    await shot(page,'01-landing',label,true);
    await page.getByRole('button',{name:'Create a family space',exact:true}).click();
    await shot(page,'02-create-join',label);
    await page.evaluate(code=>localStorage.setItem('family-practice-code',code),code);
    await page.goto(origin);
    await page.getByRole('button',{name:/Sam/}).first().waitFor();
    await shot(page,'03-kid-picker',label,true);
    await page.getByRole('button',{name:/Sam/}).first().click();
    await page.getByRole('heading',{name:'Week of Nov 10'}).first().waitFor();
    await shot(page,'04-spelling-lists',label,true);
    await page.getByRole('button',{name:'Test',exact:true}).first().click();
    const shuffle=page.getByLabel('Shuffle the words');
    if(await shuffle.count())await shuffle.uncheck();
    await page.getByRole('button',{name:'Let’s begin'}).click();
    const answer=page.getByRole('textbox',{name:'Type the spelling word'});
    await answer.waitFor();
    await typeInto(page,answer,'beauti');
    await shot(page,'05-test-typing',label);
    await typeInto(page,answer,'fl');
    await page.getByRole('button',{name:/Check word/}).click();
    await page.getByText(/Almost/).waitFor();
    await shot(page,'06-test-retry',label);
    await page.getByRole('button',{name:'End practice'}).click();
    await page.getByRole('button',{name:'Learn',exact:true}).first().click();
    if(await shuffle.count())await shuffle.uncheck();
    const learn=page.getByRole('textbox',{name:'Type the full word'});
    for(let stage=0;stage<1;stage++) {
      await learn.waitFor();
      await learn.fill('beautiful');
      await page.getByRole('button',{name:'Check word'}).click();
      await page.getByRole('button',{name:'Continue',exact:true}).click();
    }
    await page.getByText('Stage 2 of 4 · Fade',{exact:true}).waitFor();
    await typeInto(page,learn,'beau');
    await shot(page,'07-learn-fade',label);
    await page.getByRole('button',{name:'End learning'}).click();
    await page.getByRole('button',{name:'Bible Verses',exact:true}).click();
    await page.getByRole('button',{name:/Practice this verse/}).first().click();
    const blanksButton=page.getByRole('button',{name:/fill the blanks/i});
    if(await blanksButton.count())await blanksButton.first().click();
    else await page.getByRole('button',{name:'Start',exact:true}).nth(1).click();
    const blank=page.getByRole('textbox',{name:/Missing word/}).first();
    await blank.waitFor();
    await typeInto(page,blank,'wo');
    await shot(page,'08-verse-blanks',label);
    await page.getByRole('button',{name:'Back to modes'}).click();
    await page.getByRole('button',{name:'Progress',exact:true}).click();
    await page.getByRole('img',{name:'First-try spelling accuracy by list'}).waitFor();
    await shot(page,'09-progress',label,true);
    await page.getByRole('button',{name:'Parent mode',exact:true}).click();
    await page.getByLabel('Parent PIN',{exact:true}).fill(PIN);
    await page.getByRole('button',{name:'Unlock',exact:true}).click();
    await page.getByRole('button',{name:'This device',exact:true}).click();
    await page.getByLabel('Reading voice').waitFor();
    await shot(page,'10-parent-settings',label,true);
    await context.close();
  }
} finally { await browser.close(); }
console.log(`Captured ${sizes.length} sizes into ${out}. Console/page errors: ${errors.length}; third-party requests: ${external.length}.`);
if(errors.length || external.length) { console.log(errors, external); process.exitCode=1; }
