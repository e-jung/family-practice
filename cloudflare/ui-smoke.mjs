// Optional Playwright tool install only; not an application/runtime dependency.
import assert from 'node:assert/strict';
import {verseMasteryCopy} from './public/verse-mastery.js';
import {mkdir} from 'node:fs/promises';
await mkdir('.tools',{recursive:true});
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin=process.env.SMOKE_URL || 'http://localhost:8792';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw Error('Use disposable localhost only');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox']});
// Five MPEG audio frames, generated from 60 ms of mono silence (real decoder input).
const tinyMP3=Buffer.from('//NExAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExFMAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKYAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NExKwAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NExKwAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV','base64');
const errors=[],external=[];let journeys=0,cloudRequests=0,fallbackRequests=0,learnSteps=0,keyTaps=0;
async function noOverflow(page,label) {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${label}: no horizontal overflow`);
}
async function checkInstallability(page) {
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  for (const value of ['width=device-width', 'initial-scale=1', 'maximum-scale=1', 'user-scalable=no', 'viewport-fit=cover']) assert.ok(viewport.includes(value), `viewport includes ${value}`);
  assert.deepEqual(await page.evaluate(() => [getComputedStyle(document.documentElement).touchAction, getComputedStyle(document.body).touchAction]), ['manipulation', 'manipulation']);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overscrollBehavior), 'none');
  const manifestURL=await page.locator('link[rel="manifest"]').getAttribute('href');
  assert.ok(manifestURL,'page links a web app manifest');
  const response=await page.request.get(new URL(manifestURL,origin).href);
  assert.equal(response.ok(),true,'manifest is fetchable');
  const manifest=await response.json();
  assert.ok(manifest.name || manifest.short_name,'manifest names the app');
  assert.ok(['standalone','minimal-ui','fullscreen'].includes(manifest.display),'manifest supports installed display');
  assert.equal(new URL(manifest.start_url,new URL(manifestURL,origin)).origin,origin,'manifest starts on this origin');
  assert.ok(manifest.icons?.length,'manifest includes icons');
  for(const icon of manifest.icons) {
    const url=new URL(icon.src,new URL(manifestURL,origin));
    assert.equal(url.origin,origin,'icons stay first-party');
    const asset=await page.request.get(url.href);
    assert.equal(asset.ok(),true,`manifest icon loads: ${icon.src}`);
    assert.ok((await asset.body()).length>0,'manifest icon is not empty');
  }
  // This observes a real browser registration, not a mocked API or a static source check.
  await page.waitForFunction(async()=>{
    const registrations=await navigator.serviceWorker.getRegistrations();
    return registrations.some(registration=>registration.active?.state==='activated');
  });
  const registration=await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.ready;
    return {scope:registration.scope,scriptURL:registration.active.scriptURL};
  });
  assert.equal(new URL(registration.scope).origin,origin,'service worker scope is first-party');
  assert.equal(new URL(registration.scriptURL).origin,origin,'service worker script is first-party');
}
// Types with the on-screen keyboard and checks the answer field received each key.
async function oskType(page,field,text) {
  const keyboard=page.locator('[data-keyboard]');
  assert.equal(await keyboard.isVisible(),true,'touch practice shows the on-screen keyboard');
  assert.equal(await field.getAttribute('inputmode'),'none','touch practice suppresses the OS keyboard');
  for(const ch of text) { await keyboard.getByRole('button',{name:ch,exact:true}).tap(); keyTaps++; }
  assert.equal(await field.inputValue(),text,'on-screen keys typed into the answer field');
}
async function learnList(page) {
  await page.getByRole('button',{name:'Spelling',exact:true}).click();
  await page.getByRole('button',{name:'+ Add spelling list',exact:true}).click();
  await page.getByLabel('Week title').fill('Learn week');
  await page.getByLabel('One word per line').fill('friend | My friend is kind.\nlight\nkind\ncat');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  const list=page.locator('section, article, .card').filter({has:page.getByRole('heading',{name:'Learn week',exact:true})}).last();
  const plays=()=>page.evaluate(()=>window.testSpoken.length+window.testAudioStarted);
  const playsAt=n=>page.waitForFunction(n=>window.testSpoken.length+window.testAudioStarted>=n,n);
  let mark=await plays();
  await list.getByRole('button',{name:'Learn',exact:true}).click();
  const shuffle=page.getByLabel('Shuffle the words');
  if(await shuffle.count())await shuffle.uncheck();
  for(const word of ['friend','light','kind','cat']) {
    const stages=word.length<=3?[0,100]:word.length<=5?[0,50,100]:[0,50,75,100];
    for(const stage of stages) {
      const answer=page.getByRole('textbox',{name:'Type the full word',exact:true});
      await answer.waitFor();
      await noOverflow(page,`Learn ${word}/${stage}`);
      assert.equal(await page.getByRole("button",{name:"Continue",exact:true,includeHidden:true}).isVisible(),false,"cannot skip an unsubmitted Learn cue");
      const level=stage, index=stages.indexOf(stage), label={0:'Copy',50:'Fade',75:'Fade more',100:'Recall'}[stage];
      try {
        await page.getByText(`Stage ${index+1} of ${stages.length} · ${label}`,{exact:true}).waitFor();
        const indicator=page.locator('ol.learn-stages');
        assert.equal(await indicator.locator('li').count(),stages.length,'one indicator per stage');
        assert.equal(await indicator.locator('[aria-current=step]').count(),1,'exactly one current stage');
        assert.equal(await indicator.locator('[aria-current=step].current').count(),1,'current stage has the marigold current style, including after a miss');
        assert.match(await indicator.locator('[aria-current=step]').innerText(),new RegExp(label),'current indicator names stage');
        assert.equal(await indicator.getByRole('button').count(),stages.length-1,'every other stage is a tappable jump');
      }
      catch (error) { console.log("Learn stage mismatch", {word,stage,visible:await page.locator("#app").innerText()}); throw error; }
      if(word === 'friend' && stage === 0) { await playsAt(mark+3); mark=await plays(); }
      if(word === 'friend' && stage === 50) {
        await playsAt(mark+1);await page.waitForTimeout(800);
        assert.equal(await plays(),mark+1,'later Learn stages say only the word, not the sentence again');
      }
      if(word === 'friend' && stage === 50) {
        await answer.fill('frend');
        await page.getByRole('button',{name:'Check word'}).click();
        await page.getByText('Compare: friend. Then retry this stage.',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Continue',exact:true}).click();
        await page.getByText('Stage 2 of 4 · Fade',{exact:true}).waitFor();
        learnSteps++;
      }
      await page.getByRole('textbox',{name:'Type the full word',exact:true}).fill(word);
      await page.getByRole('button',{name:'Check word'}).click();
      await page.getByRole('button',{name:'Continue',exact:true}).click();
      learnSteps++;
    }
  }
  await page.getByRole('button',{name:'Take the test now',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Type the full word',exact:true}).count(),0,'Learn reaches its summary after every word and stage');
  await page.getByRole('button',{name:'Take the test now',exact:true}).click();
  await page.getByRole('button',{name:'Let’s begin'}).waitFor();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await list.getByRole('button',{name:'Learn',exact:true}).click();
  await page.locator('ol.learn-stages').getByRole('button',{name:/Recall/}).click();
  await page.getByText('Stage 4 of 4 · Recall',{exact:true}).waitFor();
  assert.equal(await page.locator('ol.learn-stages .complete').count(),0,'skipped cues are not falsely marked completed');
  await page.getByRole('textbox',{name:'Type the full word',exact:true}).fill('friend');
  await page.getByRole('button',{name:'Check word'}).click();
  await page.getByText('Learned! You spelled it with no clues.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByText('Stage 1 of 3 · Copy',{exact:true}).waitFor();
  const skipResponse=page.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith('/api/attempts') && r.request().postDataJSON().step==='skip');
  await page.getByRole('button',{name:'I know these — start the test',exact:true}).click();
  assert.equal((await skipResponse).ok(),true,'Learn-to-Test skip is saved');
  await page.getByRole('heading',{name:'Spelling test',exact:true}).waitFor();
  await page.getByText('4 words. You’ll hear the word, a sentence, then the word again. You get one retry.',{exact:true}).waitFor();
  assert.equal(await page.locator('.practice-band').getByText('Learn week',{exact:true}).count(),1,'skip keeps the same list');
  const skipped=await page.evaluate(async()=>{const code=localStorage.getItem('family-practice-code');const r=await fetch('/api/admin/export',{headers:{'X-Family-Code':code}});return (await r.json()).attempts.filter(a=>a.step==='skip');});
  assert.ok(skipped.length>=4,'recall shortcut and all remaining Learn words record skips');
  assert.ok(skipped.every(a=>!a.correct && !a.first_try),'skips are not correct recall wins');
  await page.getByRole('button',{name:'Let’s begin'}).waitFor();
}
async function reviewJourney(page,code) {
  // Export/import is the supported fixture seam; never mutate SQLite directly.
  const fixture=await page.evaluate(async code=>{
    const call=async(path,data)=>{
      const r=await fetch(path,{method:data===undefined?'GET':'POST',headers:{'X-Family-Code':code,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
      if(!r.ok)throw Error(`${path}: ${r.status}`);return r.json();
    };
    const b=await call('/api/admin/export'), kid=b.kids.find(k=>k.name==='Alex');
    const past=new Date(Date.now()-30*86400000).toISOString();
    for(const row of [...b.attempts,...b.sessions])row.created_at=past;
    delete b.wordBank; // Replay the deliberately aged attempt fixture.
    await call('/api/admin/import',b);
    const review=await call('/api/review?kid='+kid.id);
    return {kidId:kid.id,review};
  },code);
  for(const key of ['due','nextDue','counts','struggling','dueSoon','words'])assert.ok(key in fixture.review,`review API exposes ${key}`);
  assert.ok(fixture.review.due.length>0,'old attempts seed due reviews');
  await page.reload();
  await page.getByRole('button',{name:/Alex/}).click();
  await page.getByRole('heading',{name:'Review',exact:true}).waitFor();
  await page.getByText(`${fixture.review.due.length} words due today`,{exact:true}).waitFor();
  await page.getByRole('button',{name:'Start review',exact:true}).click();
  await page.getByLabel('Shuffle the words').uncheck();
  const started=page.waitForResponse(r=>r.url().endsWith('/api/sessions') && r.request().method()==='POST');
  await page.getByRole('button',{name:'Let’s begin'}).click();
  const sessionResponse=await started;
  assert.equal(sessionResponse.request().postDataJSON().kind,'review','review is not a spelling test');
  const session=await sessionResponse.json();
  // Use the persisted session word selection with shuffle explicitly disabled.
  const ordered=await page.evaluate(async({code,id})=>{
    const r=await fetch('/api/admin/export',{headers:{'X-Family-Code':code}}), b=await r.json();
    const row=b.sessions.find(s=>s.id===id);
    return JSON.parse(row.word_ids).map(id=>b.words.find(w=>w.id===id).word);
  },{code,id:session.id});
  for(let i=0;i<ordered.length;i++) {
    await page.getByLabel('Type the spelling word').fill(ordered[i]);
    await page.getByRole('button',{name:'Check word'}).click();
    await page.getByRole('button',{name:i===ordered.length-1?'See my results':'Next word',exact:true}).click();
  }
  await page.getByRole('button',{name:'Back to spelling',exact:true}).click();
  await page.getByText(/^Nothing due — next review (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/).waitFor();
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await page.getByRole('heading',{name:'Word bank',level:2,exact:true}).waitFor();
  const bank=await page.evaluate(async({code,kidId})=>{const r=await fetch('/api/review?kid='+kidId,{headers:{'X-Family-Code':code}});return r.json();},{code,kidId:fixture.kidId});
  for(const [label,key] of [['Learning','learning'],['Getting it','gettingIt'],['Mastered','mastered']]) {
    const count=page.locator('.bank-counts > div').filter({has:page.getByText(label,{exact:true})});
    await count.waitFor();
    assert.equal(await count.locator('dd').innerText(),String(bank.counts[key]),`${label} count agrees with review API`);
  }
  await noOverflow(page,'word bank');
}
try {
  for(const width of [1440,390]) {
    const context=await browser.newContext({extraHTTPHeaders:{'CF-Connecting-IP':`198.18.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*254)+1}`},viewport:{width,height:width===390?844:1000},...(width===390?{isMobile:true,hasTouch:true}:{})});
    const page=await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error' && !(m.location().url.includes('/api/tts?') && /503/.test(m.text())))errors.push(m.text());});
    page.on('request',r=>{if(new URL(r.url()).origin!==origin)external.push(r.url());});
    let speechMode=width===1440?'success':'503';
    const requests=[]; let cancelRequestStarted = () => {};
    await context.route('**/api/tts?*',async route=>{
      const request=route.request(),url=new URL(request.url());
      assert.ok(request.headers()['x-family-code'],'cloud audio carries family header');
      assert.equal(url.searchParams.get('lang'),'en');
      assert.equal(url.searchParams.has('voice'),false);
      requests.push(url.searchParams.get('text'));
      if(speechMode==='timeout') { await new Promise(resolve=>setTimeout(resolve,4500)); await route.abort().catch(()=>{}); return; }
      if(speechMode==='503') { fallbackRequests++; await route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}); }
      else { cloudRequests++; if(speechMode==='cancel'){cancelRequestStarted();await new Promise(resolve=>setTimeout(resolve,1200));} await route.fulfill({status:200,contentType:'audio/mpeg',body:tinyMP3}).catch(()=>{}); }
    });
    await page.addInitScript(()=>{
      window.testSpoken=[];window.testAudioEnded=0;window.testAudioStarted=0;window.testPitchPreserved=true;
      speechSynthesis.speak=u=>{window.testSpoken.push(u.text);setTimeout(()=>u.onend?.(),10);};speechSynthesis.cancel=()=>{};
      const play=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(){if(!this.hasAttribute("data-voice-clip"))return play.call(this);window.testAudioStarted++;window.testPitchPreserved &&= this.preservesPitch;this.addEventListener('ended',()=>window.testAudioEnded++,{once:true});return play.call(this);};
    });
    await page.goto(origin);await checkInstallability(page);await noOverflow(page,'onboarding');await page.getByRole('button',{name:'Create a family space',exact:true}).click();
    if(width===1440)await page.getByLabel('Family space name (optional)',{exact:true}).fill('Browser family');
    await page.getByLabel('Parent PIN (4–8 digits)',{exact:true}).fill('2468');
    await page.getByLabel('Repeat parent PIN',{exact:true}).fill('2468');
    await page.getByRole('button',{name:'Create family space',exact:true}).click();
    await page.getByRole('button',{name:'Print code card'}).waitFor();
    const code=await page.locator('.family-code').textContent();assert.match(code,/^[a-z]+-[a-z]+-[a-z]+-\d{4}$/);
    assert.ok(await page.getByText(/Save this code/).isVisible());
    await page.getByRole('button',{name:'Back to practice',exact:true}).click();
    await page.getByRole('button',{name:'+ Add your first kid',exact:true}).click();
    await page.getByLabel('First name or nickname',{exact:true}).fill('Alex');
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.getByRole('button',{name:/Alex/}).click();
    await page.getByRole('button',{name:'+ Add spelling list',exact:true}).click();
    await page.getByLabel('Week title').fill('Browser week');
    await page.getByLabel('One word per line').fill('friend | My friend is kind.\nlight | Turn on the light.\nkind | Be kind to others.');
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.getByRole('heading',{name:'Browser week',exact:true}).waitFor();
    await page.getByRole('heading',{name:'Review',exact:true}).waitFor();
    await page.getByText('Nothing due — learn or test some words to begin.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Test',exact:true}).click();
    await page.getByLabel('Shuffle the words').uncheck();await page.getByRole('button',{name:'Let’s begin'}).click();
    if(width===1440) {
      assert.equal(await page.locator('[data-keyboard]').count(),0,'desktop keeps the physical keyboard');
      assert.notEqual(await page.getByLabel('Type the spelling word').getAttribute('inputmode'),'none','desktop allows the native keyboard');
      await page.waitForFunction(()=>window.testAudioEnded>=3);
      assert.equal(await page.evaluate(()=>window.testPitchPreserved),true,'playback preserves speech pitch');
      assert.deepEqual(await page.evaluate(()=>window.testSpoken),[],'real MP3 cloud playback does not use fallback');
      for(const text of ['friend','My friend is kind.','light','Turn on the light.'])assert.ok(requests.includes(text),'prefetched '+text);
      assert.equal(requests.includes('kind'),false,'only the first two words prefetch initially');
      const count=requests.length;
      await page.getByRole('button',{name:'Say again'}).click();
      await page.waitForFunction(()=>window.testAudioEnded>=6);
      assert.equal(requests.length,count,'replay reuses blob LRU');
      await page.getByLabel('Type the spelling word').fill('wrong');await page.getByRole('button',{name:'Check word'}).click();
      await page.waitForFunction(()=>window.testAudioEnded>=7);
      await page.getByLabel('Type the spelling word').fill('wrong again');await page.getByRole('button',{name:'Check word'}).click();
      await page.waitForFunction(()=>window.testAudioEnded>=8);
      assert.equal(requests.length,count,'second miss replays the cached word clip, no new cloud request');
    } else {
      await page.waitForFunction(()=>window.testSpoken.length>=3);
      assert.equal(await page.locator('#voice-status').textContent(),'Device voice active · cloud voice temporarily unavailable');
      assert.equal(await page.locator('#voice-status').isVisible(),false,'voice diagnostics never show on the child practice screen');
      await oskType(page,page.getByLabel('Type the spelling word'),'friends');
      await page.locator('[data-keyboard]').getByRole('button',{name:'Delete'}).tap();
      assert.equal(await page.getByLabel('Type the spelling word').inputValue(),'friend','on-screen Delete removes one letter');
      await page.getByRole('button',{name:'Check word'}).tap();
    }
    await page.getByRole('button',{name:'Next word'}).click();
    if(width===1440) {
      await page.waitForFunction(()=>document.querySelector('#answer')!==null);
      await page.waitForTimeout(100);
      assert.ok(requests.includes('kind') && requests.includes('Be kind to others.'),'one word/sentence ahead prefetch');
    }
    await page.getByLabel('Type the spelling word').fill('light');await page.getByRole('button',{name:'Check word'}).click();
    await page.getByRole('button',{name:'Next word'}).click();
    await page.getByLabel('Type the spelling word').fill('kind');await page.getByRole('button',{name:'Check word'}).click();
    await page.getByRole('button',{name:'See my results'}).click();await page.getByText(width===1440?'2 / 3':'3 / 3',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Back to spelling',exact:true}).click();
    await page.getByRole('button',{name:'Bible Verses',exact:true}).click();
    await page.getByRole('button',{name:'+ Add Bible verse',exact:true}).click();
    await page.getByLabel('Reference (for example Psalm 23:1)').fill('John 11:35');
    await page.getByLabel('Verse text · paste your chosen wording').fill('Jesus wept.');
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.getByRole('button',{name:'Practice this verse'}).click();
    await page.getByRole('button',{name:/Learn it/}).click();
    await page.getByRole('heading',{name:'Step 1 of 4',exact:true}).waitFor();
    await page.keyboard.type('jw');
    await page.getByRole('button',{name:'Next step',exact:true}).click();
    await page.getByRole('heading',{name:'Step 2 of 4',exact:true}).waitFor();
    await page.getByRole('button',{name:'Back to modes'}).click();
    await page.getByRole('button',{name:'Back to verses'}).click();
    await page.getByRole('button',{name:'Progress',exact:true}).click();
    await page.getByRole('heading',{name:'Verse garden'}).waitFor();
    await page.getByText(verseMasteryCopy(), {exact:true}).waitFor();
    await page.getByRole('img',{name:'First-try spelling accuracy by list'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
    if(width===390)assert.ok((await page.evaluate(()=>window.testSpoken)).length>0);
    else {
      // Saved device choice must bypass cloud; switching back clears the failure cooldown.
      await page.getByRole('button',{name:'Parent mode',exact:true}).click();
      if (!await page.locator('.parent-more').evaluate(e => e.open)) await page.locator('.parent-more > summary').click();
      await page.getByRole('button',{name:'This device',exact:true}).click();
      assert.equal(await page.getByLabel('Reading voice').inputValue(),'cloud');
      await page.getByLabel('Reading voice').selectOption('device');
      await page.getByRole('button',{name:'Save voice settings'}).click();
      await page.getByText('Voice settings saved.',{exact:true}).waitFor();
      const count=requests.length;
      await page.getByRole('button',{name:'Test voice',exact:true}).click();
      assert.equal(requests.length,count,'device choice avoids cloud');
      await page.waitForFunction(()=>window.testSpoken.includes('A little practice helps us grow.'));
      await page.getByLabel('Reading voice').selectOption('cloud');
      await Promise.all([page.waitForResponse(r=>r.url().includes('/api/state')&&r.status()===200),page.getByRole('button',{name:'Save voice settings'}).click()]);
      speechMode='timeout';
      const start=Date.now();
      await page.getByRole('button',{name:'Test voice',exact:true}).click();
      await page.getByText('Device voice active · cloud voice temporarily unavailable',{exact:true}).waitFor();
      const elapsed=Date.now()-start;
      assert.ok(elapsed>=3900 && elapsed<6000,`cloud fetch timeout fell back at ${elapsed} ms`);
      await page.getByText('Device voice active · cloud voice temporarily unavailable',{exact:true}).waitFor();
      assert.equal((await page.evaluate(()=>window.testSpoken)).filter(t=>t==='A little practice helps us grow.').length,2,'timeout falls back once');
      // Navigating away must cancel a pending cloud fetch and the remaining sequence.
      await Promise.all([page.waitForResponse(r=>r.url().includes('/api/state')&&r.status()===200),page.getByRole('button',{name:'Save voice settings'}).click()]);
      speechMode='cancel';
      const before=await page.evaluate(()=>({spoken:window.testSpoken.length,audio:window.testAudioStarted}));
      const requestStarted = new Promise(resolve => { cancelRequestStarted = resolve; });
      const triggerVoice = page.getByRole('button',{name:'Test voice',exact:true}).evaluate(button=>button.click());
      await requestStarted;
      await page.getByRole('button',{name:'Done',exact:true}).evaluate(button=>button.click());
      await triggerVoice;
      await page.waitForTimeout(1400);
      assert.deepEqual(await page.evaluate(()=>({spoken:window.testSpoken.length,audio:window.testAudioStarted})),before,'navigation cancels stale speech without fallback');
      speechMode='success';
    }
    await learnList(page);
    await page.getByRole('button',{name:'Back',exact:true}).click();
    await reviewJourney(page,code);
    if(width===390) {
      await page.setViewportSize({width:360,height:800});
      await noOverflow(page,'360px test setup');
      await page.getByRole('button',{name:'Spelling',exact:true}).click();
      await noOverflow(page,'360px list view');
      await page.setViewportSize({width:390,height:844});
    }
    await page.screenshot({path:`.tools/public-${width}.png`,fullPage:true});
    assert.equal(await page.locator('[data-keyboard]').count(),0,'keyboard leaves with the practice screen');
    await page.getByRole('button',{name:'Switch kid',exact:true}).click();
    await page.getByRole('button',{name:'Switch family',exact:true}).click();
    await page.getByRole('heading',{name:'A small daily habit. A family that grows.'}).waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('family-practice-code')),null);
    await page.getByRole('button',{name:'I have a family code'}).click();
    await page.getByLabel('Family code',{exact:true}).fill(code);await page.getByRole('button',{name:'Join family',exact:true}).click();
    await page.getByRole('button',{name:/Alex/}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Lock',exact:true}).count(),0,'switch locked parent cookie');
    await page.goto(origin+'/f/'+code);assert.equal(await page.getByLabel('Family code',{exact:true}).inputValue(),code);
    await page.goto(origin+'/privacy');await page.getByRole('heading',{name:'Privacy & your family’s data'}).waitFor();
    // Delete disposable space with re-unlock, without expecting browser 401 errors.
    const deleted=await page.evaluate(async({code})=>{
      const post=(path,data)=>fetch(path,{method:'POST',headers:{'X-Family-Code':code,'Content-Type':'application/json'},body:JSON.stringify(data)});
      const unlocked=await post('/api/parent/unlock',{pin:'2468'});if(!unlocked.ok)return false;
      return (await post('/api/admin/delete-family',{pin:'2468',confirmation:code})).ok;
    },{code});assert.equal(deleted,true);
    journeys++;await context.close();
  }
  // Key sounds: nothing loads or plays before a gesture; a tap then loads the CC0 tick.
  {
    const context=await browser.newContext({extraHTTPHeaders:{'CF-Connecting-IP':`198.18.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*254)+1}`},viewport:{width:1280,height:800}});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    const samples=[];page.on('request',r=>{if(r.url().includes('/audio/'))samples.push(r.url());});
    await page.addInitScript(()=>{
      localStorage.setItem('family-practice-device',JSON.stringify({keySounds:true,haptics:false,keyboard:'auto'}));
      window.testContexts=0;const Real=window.AudioContext;
      window.AudioContext=class extends Real{constructor(...a){super(...a);window.testContexts++;}};
    });
    await page.goto(origin);await page.getByRole('button',{name:'I have a family code'}).waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>window.testContexts),0,'no audio context before a user gesture');
    assert.equal(samples.length,0,'no key sound fetched before a user gesture');
    await page.getByRole('button',{name:'I have a family code'}).click();
    await page.waitForFunction(()=>window.testContexts>=1);
    await page.waitForTimeout(300);
    assert.ok(samples.some(u=>u.endsWith('/audio/interface-click-002.mp3')),'first gesture loads the key sample');
    await context.close();
  }
  // iOS haptics: each button gets a native switch overlay; one tap clicks the button exactly once.
  {
    const context=await browser.newContext({extraHTTPHeaders:{'CF-Connecting-IP':`198.18.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*254)+1}`},viewport:{width:390,height:844},isMobile:true,hasTouch:true,
      userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{delete Navigator.prototype.vibrate;localStorage.setItem('family-practice-device',JSON.stringify({keySounds:false,haptics:true,keyboard:'auto'}));});
    await page.goto(origin);
    const target=page.getByRole('button',{name:'I have a family code'});
    await target.waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('.haptic-overlay').length>=document.querySelectorAll('button').length);
    assert.equal(await page.locator('.haptic-overlay[switch][aria-hidden="true"]').count(),await page.locator('button').count(),'every button has one hidden native switch');
    await target.evaluate(b=>{window.testClicks=0;b.addEventListener('click',()=>window.testClicks++);});
    const box=await target.boundingBox();
    await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>window.testClicks),1,'overlay tap activates its button exactly once');
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('haptic-overlay')),false,'focus never rests on the hidden switch');
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(`PASS: ${journeys} complete desktop/mobile journeys, onboarding → kid/list → spelling → verse → progress → Learn4/short-word stages/skip-to-recall/skip-to-test → due Review → word bank → switch/join/privacy; manifest parsed, icons fetched, actual service worker activated; zero console/page errors or third-party requests. Cloud MP3 decoded/played; 503 and 4-second timeout fell back to instrumented device speech; device choice, blob reuse, initial two + one-ahead word/sentence prefetch, navigation cancellation and single-request spelling verified. Learn stages=${learnSteps}; on-screen key taps=${keyTaps}; key sound waits for a gesture; iOS switch overlay clicks once; Cloud requests=${cloudRequests}, mocked 503 requests=${fallbackRequests}. Speech not listened to by a human.`);
} finally {await browser.close();}
