import test from 'node:test';
import assert from 'node:assert/strict';

import {emptyFixture,fixture} from '../fixture-support.js';
test("API explicitly populates kids, protects parent data, writes lists, records attempts and progress", async (t) => {
  const { req } = await fixture(t);
  const initial = await req("/api/state?kid=1");
  assert.equal(initial.body.kids.length, 2);
  assert.equal(initial.body.lists[0].words.length, 2);
  assert.equal(
    (await req("/api/admin/lists", { kid_id: 1, title: "test", words: [] }))
      .status,
    401,
  );
  assert.equal((await req("/api/admin/export")).status, 401);
  assert.equal((await req("/api/parent/unlock", { pin: "wrong" })).status, 401);
  assert.equal((await req("/api/parent/unlock", { pin: "5678" })).status, 200);
  const created = await req("/api/admin/lists", {
    kid_id: 1,
    title: "Week test",
    date: "2026-11-13",
    words: [{ word: "neighbor", sentence: "Our neighbor is kind." }],
  });
  assert.equal(created.status, 201);
  const state = (await req("/api/state?kid=1")).body;
  const list = state.lists.find((l) => l.id === created.body.id);
  const session = (
    await req("/api/sessions", {
      kid_id: 1,
      list_id: list.id,
      kind: "spelling",
    })
  ).body;
  const attempt = await req("/api/attempts", {
    session_id: session.id,
    word_id: list.words[0].id,
    typed: "neighbr",
  });
  assert.equal(attempt.body.correct, false);
  assert.equal(attempt.body.first_try, true);
  const retry = await req("/api/attempts", {
    session_id: session.id,
    word_id: list.words[0].id,
    typed: " Neighbor ",
  });
  assert.equal(retry.body.correct, true);
  assert.equal(retry.body.first_try, false);
  assert.equal(
    (
      await req("/api/attempts", {
        session_id: session.id,
        word_id: list.words[0].id,
        typed: "neighbor",
      })
    ).status,
    400,
  );
  await req("/api/sessions/complete", { session_id: session.id });
  const p = (await req("/api/progress?kid=1")).body;
  assert.equal(p.listsCompleted, 1);
  assert.equal(p.charts.find((l) => l.id === list.id).accuracy, 0);
  assert.equal(p.tricky[0].word, "neighbor");
  assert.equal(p.attempts.length, 2);
  assert.equal((await req("/api/progress?kid=2")).body.attempts.length, 0);
  assert.equal((await req("/api/tts/status")).body.reachable, false);
  assert.equal((await req("/api/tts?text=hello")).status, 503);
  assert.equal((await req("/api/parent/lock", {})).status, 200);
  assert.equal((await req("/api/admin/export")).status, 401);
});
test("API verse checking, kid management, settings and transactional backup restore", async (t) => {
  const { req } = await fixture(t);
  await req("/api/parent/unlock", { pin: "5678" });
  await req("/api/admin/kids", { name: "Casey", grade: "K" });
  assert.equal((await req("/api/state")).body.kids.length, 3);
  await req("/api/admin/kids", { id: 3, name: "Riley", grade: "1" });
  assert.equal((await req("/api/state")).body.kids[2].name, "Riley");
  const created = await req("/api/admin/verses", {
    kid_id: 3,
    reference: "John 11:35",
    text: "Jesus wept.",
    translation: "KJV",
  });
  const session = (await req("/api/sessions", { kid_id: 3, kind: "verse" }))
    .body;
  const result = await req("/api/verse-attempts", {
    session_id: session.id,
    verse_id: created.body.id,
    mode: "memory",
    typed: "JESUS WEPT!",
  });
  assert.equal(result.body.accuracy, 100);
  await req("/api/sessions/complete", { session_id: session.id });
  assert.equal((await req("/api/progress?kid=3")).body.mastery[0].stars, 3);
  const settings = await req("/api/admin/settings", {
    voice: "en_US-ryan-high",
    speed: 0.8,
  });
  assert.equal(settings.status, 200);
  assert.equal((await req("/api/state")).body.settings.speed, 0.8);
  const backup = (await req("/api/admin/export")).body;
  assert.equal(backup.format, "family-practice");
  const bad = structuredClone(backup);
  bad.words[0].list_id = 9999;
  assert.equal((await req("/api/admin/import", bad)).status, 400);
  assert.equal((await req("/api/state")).body.kids.length, 3);
  await req("/api/admin/kids", { name: "Temporary" });
  assert.equal((await req("/api/admin/import", backup)).status, 200);
  assert.equal((await req("/api/state")).body.kids.length, 3);
  assert.match(
    (await req("/api/admin/export?format=csv")).body,
    /"table","id","name"/,
  );
});
test("API rejects cross-origin writes, invalid words and cross-kid attempts; archive preserves history", async (t) => {
  const { req } = await fixture(t);
  assert.equal(
    (
      await req(
        "/api/sessions",
        { kid_id: 1, kind: "spelling" },
        { Origin: "http://evil.example" },
      )
    ).status,
    403,
  );
  await req("/api/parent/unlock", { pin: "5678" });
  assert.equal(
    (await req("/api/admin/lists", { kid_id: 1, title: "Empty", words: [] }))
      .status,
    400,
  );
  const s = (await req("/api/state?kid=1")).body;
  const sess = (
    await req("/api/sessions", {
      kid_id: 2,
      kind: "tricky",
      word_ids: [(await req("/api/state?kid=2")).body.lists[0].words[0].id],
    })
  ).body;
  assert.equal(
    (
      await req("/api/attempts", {
        session_id: sess.id,
        word_id: s.lists[0].words[0].id,
        typed: "x",
      })
    ).status,
    400,
  );
  await req("/api/admin/archive", { type: "lists", id: s.lists[0].id });
  await req("/api/parent/lock", {});
  assert.equal((await req("/api/state?kid=1")).body.lists.length, 0);
  assert.equal((await req("/../../server.js")).status, 404);
});

test("mastery follows practiced wording; unfinished/subset rounds do not complete full lists", async (t) => {
  const { req } = await fixture(t);
  await req("/api/parent/unlock", { pin: "5678" });
  const state = (await req("/api/state?kid=1")).body;
  const v = state.verses[0];
  const verseSession = (
    await req("/api/sessions", { kid_id: 1, kind: "verse" })
  ).body;
  await req("/api/verse-attempts", {
    session_id: verseSession.id,
    verse_id: v.id,
    mode: "memory",
    typed: v.text,
  });
  assert.equal((await req("/api/progress?kid=1")).body.mastery[0].stars, 3);
  await req("/api/admin/verses", { ...v, text: "Jesus wept." });
  const p = (await req("/api/progress?kid=1")).body;
  assert.equal(p.mastery[0].stars, 0);
  assert.equal(p.verseAttempts[0].verse_text, v.text);
  const list = state.lists[0];
  const full = (
    await req("/api/sessions", {
      kid_id: 1,
      list_id: list.id,
      kind: "spelling",
    })
  ).body;
  await req("/api/attempts", {
    session_id: full.id,
    word_id: list.words[0].id,
    typed: list.words[0].word,
  });
  assert.equal(
    (await req("/api/sessions/complete", { session_id: full.id })).status,
    400,
  );
  const subset = (
    await req("/api/sessions", {
      kid_id: 1,
      list_id: list.id,
      kind: "spelling",
      word_ids: [list.words[0].id],
    })
  ).body;
  await req("/api/attempts", {
    session_id: subset.id,
    word_id: list.words[0].id,
    typed: list.words[0].word,
  });
  assert.equal(
    (await req("/api/sessions/complete", { session_id: subset.id })).status,
    200,
  );
  assert.equal((await req("/api/progress?kid=1")).body.listsCompleted, 0);
  for (const word of list.words.slice(1))
    await req("/api/attempts", {
      session_id: full.id,
      word_id: word.id,
      typed: word.word,
    });
  assert.equal(
    (await req("/api/sessions/complete", { session_id: full.id })).status,
    200,
  );
  assert.equal((await req("/api/progress?kid=1")).body.listsCompleted, 1);
});

test('signed parent cookies reject tampering, survive DO restart, and expire securely',async t=>{
  const f=await fixture(t);
  const unlocked=await f.req('/api/parent/unlock',{pin:'5678'});
  assert.equal(unlocked.status,200);
  assert.match(unlocked.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax; Max-Age=43200/);
  const valid=f.getCookie();
  f.setCookie(valid.replace(/.$/,valid.endsWith('a')?'b':'a'));
  assert.equal((await f.req('/api/admin/export')).status,401);
  f.setCookie(valid);
  assert.equal((await f.req('/api/admin/export')).status,200);
  // Verification depends on shared secrets, not an isolate-local session map.
  const {isParent,signSession,sha256}=await import('../auth.js');
  assert.equal(await isParent(new Request('https://family.example',{headers:{cookie:valid}}),{...f.env,familyIdHash:await sha256(await sha256(f.getCode())+f.db.prepare('SELECT session_epoch FROM family').get().session_epoch)}),true);
  const original=Date.now;let expired;
  try {Date.now=()=>original()-43200001;expired=await signSession(f.env.SESSION_SECRET,await sha256(await sha256(f.getCode())+f.db.prepare('SELECT session_epoch FROM family').get().session_epoch));}finally{Date.now=original;}
  f.setCookie('parent='+expired);
  assert.equal((await f.req('/api/admin/export')).status,401);
});

test('PIN failures persist in SQL and block after ten attempts for fifteen minutes',async t=>{
  const {req,db}=await fixture(t);
  for(let i=0;i<10;i++) assert.equal((await req('/api/parent/unlock',{pin:'bad'})).status,401);
  assert.equal(db.prepare('SELECT count FROM pin_limit').get().count,10);
  assert.equal((await req('/api/parent/unlock',{pin:'5678'})).status,429);
  db.exec('UPDATE pin_limit SET until=0');
  assert.equal((await req('/api/parent/unlock',{pin:'5678'})).status,200);
});

test('Worker config, input limits, missing secrets, and parent-only editing',async t=>{
  const {req,env}=await fixture(t);
  assert.deepEqual((await req('/api/config')).body,{serverTts:true});
  assert.equal((await req('/')).status,200);
  assert.equal((await req('/api/state')).body.settings.serverTts,true);
  for(const route of ['kids','lists','verses','archive','settings','import'])
    assert.equal((await req('/api/admin/'+route,{})).status,401);
  assert.equal((await req('/api/parent/unlock',{pin:'x'.repeat(2200)})).status,413);
  env.SESSION_SECRET='';
  assert.equal((await req('/api/parent/unlock',{pin:'5678'})).status,503);
  env.SESSION_SECRET='test-secret-32-characters-minimum-long';
  assert.equal((await req('/api/parent/unlock',{pin:'5678'})).status,200);
  assert.equal((await req('/api/admin/lists',{kid_id:1,title:'invalid date',date:'2026-02-30',words:[{word:'abc'}]})).status,400);
  assert.equal((await req('/api/admin/settings',{voice:'Ava',speed:1})).status,200);
  assert.equal((await req('/api/state')).body.settings.voice,'Ava');
});

test('verse blank mode and invalid input shapes preserve validation',async t=>{
  const {req}=await fixture(t);
  const state=(await req('/api/state?kid=1')).body;
  const verse=state.verses[0];
  const session=(await req('/api/sessions',{kid_id:1,kind:'verse'})).body;
  const expected=verse.text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
  const result=await req('/api/verse-attempts',{session_id:session.id,verse_id:verse.id,mode:'blanks',level:100,indices:expected.map((_,i)=>i),typed:expected.join(' ')});
  assert.equal(result.status,200);assert.equal(result.body.accuracy,100);
  assert.equal((await req('/api/verse-attempts',{session_id:session.id,verse_id:verse.id,mode:'memory',level:'bad',typed:''})).status,400);
  await req('/api/parent/unlock',{pin:'5678'});
  assert.equal((await req('/api/admin/lists',{kid_id:1,title:'bad',words:[null]})).status,400);
});

test('family codes use 2048 unique kid-safe words and unbiased 46-bit format',async()=>{
  const {CODE_WORDS,generateFamilyCode,validCode}=await import('../auth.js');
  assert.equal(CODE_WORDS.length,2048);assert.equal(new Set(CODE_WORDS).size,2048);
  assert.ok(3*Math.log2(CODE_WORDS.length)+Math.log2(10000)>40);
  const generated=new Set();for(let i=0;i<1000;i++) {
    const code=generateFamilyCode();assert.ok(validCode(code));const parts=code.split('-');
    for(const word of parts.slice(0,3))assert.ok(CODE_WORDS.includes(word));generated.add(code);
  }
  assert.equal(generated.size,1000);
});
test('create starts empty, lookup cannot create, codes isolate families and sessions',async t=>{
  const f=emptyFixture(t);
  const created=await f.req('/api/families',{name:'Maple',pin:'123456'});
  assert.equal(created.status,201);const a=f.getCode(),cookieA=f.getCookie();
  assert.equal((await f.req('/api/state')).body.kids.length,0);
  await f.req('/api/admin/kids',{name:'Robin'});
  const hash=await (await import('../auth.js')).sha256(a);
  assert.ok(f.databases.has('fam:'+hash));assert.ok(!f.databases.has(a));
  assert.notEqual(f.db.prepare('SELECT pin_hash FROM family').get().pin_hash,'123456');
  f.setCode('amberapple-aquaapple-blueapple-0000');
  assert.equal((await f.req('/api/state')).status,404);
  assert.equal((await f.req('/api/internal/create',{pin:'1111'})).status,404);
  const missing=[...f.databases].find(([k])=>k.startsWith('fam:') && k!=='fam:'+hash)[1];
  assert.equal(missing.db.prepare('SELECT COUNT(*) n FROM family').get().n,0);
  assert.equal((await f.req('/api/families',{name:'Birch',pin:'8765'})).status,201);
  const b=f.getCode(),cookieB=f.getCookie();
  assert.equal((await f.req('/api/state')).body.kids.length,0);
  f.setCookie(cookieA);
  assert.equal((await f.req('/api/admin/export')).status,401);
  assert.equal((await f.req('/api/state')).body.parent,false);
  f.setCode(a);assert.equal((await f.req('/api/state')).body.kids[0].name,'Robin');
  f.setCookie(cookieB);assert.equal((await f.req('/api/admin/kids',{name:'Intruder'})).status,401);
  f.setCookie('');assert.equal((await f.req('/api/state')).body.kids.length,1);
  assert.notEqual(a,b);
});
test('creation limits five per IP/hour and 200/day globally, expire durably',async t=>{
  const f=emptyFixture(t);
  for(let i=0;i<5;i++)assert.equal((await f.req('/api/families',{pin:'1234'})).status,201);
  assert.equal((await f.req('/api/families',{pin:'1234'})).status,429);
  assert.equal((await f.req('/api/families',{pin:'1234'},{'CF-Connecting-IP':'192.0.2.2'})).status,201);
  const db=f.databases.get('registry').db;
  db.exec("UPDATE limits SET count=200 WHERE key='global'");
  assert.equal((await f.req('/api/families',{pin:'1234'},{'CF-Connecting-IP':'192.0.2.3'})).status,429);
  db.exec('UPDATE limits SET until=0');
  assert.equal((await f.req('/api/families',{pin:'1234'})).status,201);
});
test('lookup failures are limited per IP and do not count ordinary missing routes',async t=>{
  const f=emptyFixture(t);await f.req('/api/families',{pin:'1234'});const code=f.getCode();
  for(let i=0;i<35;i++)assert.equal((await f.req('/api/nonexistent')).status,404);
  f.setCode('amberapple-aquaapple-blueapple-0001');
  for(let i=0;i<30;i++)assert.equal((await f.req('/api/state')).status,404);
  assert.equal((await f.req('/api/state')).status,429);
  assert.equal((await f.req('/api/state',undefined,{'CF-Connecting-IP':'192.0.2.5'})).status,404);
  f.databases.get('registry').db.exec('UPDATE limits SET until=0');f.setCode(code);
  assert.equal((await f.req('/api/state')).status,200);
});
test('all parent routes require a parent session; PIN changes invalidate old sessions',async t=>{
  const f=await fixture(t);
  for(const route of ['kids','lists','verses','settings','import','sample','remove-kid','pin','delete-family'])
    assert.equal((await f.req('/api/admin/'+route,{})).status,401);
  await f.req('/api/parent/unlock',{pin:'5678'});const old=f.getCookie();
  assert.equal((await f.req('/api/admin/pin',{currentPin:'0000',pin:'1234'})).status,401);
  assert.equal((await f.req('/api/admin/pin',{currentPin:'5678',pin:'12345678'})).status,200);
  const current=f.getCookie();f.setCookie(old);assert.equal((await f.req('/api/admin/export')).status,401);
  f.setCookie(current);assert.equal((await f.req('/api/admin/export')).status,200);
  await f.req('/api/parent/lock',{});
  assert.equal((await f.req('/api/parent/unlock',{pin:'5678'})).status,401);
  assert.equal((await f.req('/api/parent/unlock',{pin:'12345678'})).status,200);
});
test('content, family, import and request size limits are enforced transactionally',async t=>{
  const f=await fixture(t),{req,db}=f;await req('/api/parent/unlock',{pin:'5678'});
  for(let i=2;i<10;i++)assert.equal((await req('/api/admin/kids',{name:'Kid'+i})).status,200);
  assert.equal((await req('/api/admin/kids',{name:'Overflow'})).status,400);
  assert.equal((await req('/api/admin/lists',{kid_id:1,title:'Large',words:Array.from({length:101},()=>({word:'a'}))})).status,400);
  assert.equal((await req('/api/admin/verses',{kid_id:1,reference:'Long',text:'a'.repeat(2001)})).status,400);
  for(let i=2;i<200;i++)db.prepare("INSERT INTO lists(kid_id,title,date) VALUES(1,?,'2026-11-13')").run('List'+i);
  assert.equal((await req('/api/admin/lists',{kid_id:1,title:'Overflow',words:[{word:'a'}]})).status,400);
  for(let i=2;i<300;i++)db.prepare("INSERT INTO verses(kid_id,reference,text) VALUES(1,?,'Text')").run('Verse'+i);
  assert.equal((await req('/api/admin/verses',{kid_id:1,reference:'Overflow',text:'a'})).status,400);
  assert.equal((await req('/api/admin/kids',{name:'a'.repeat(256*1024)})).status,413);
  assert.equal((await req('/api/admin/import',{extra:'a'.repeat(2*1024*1024)})).status,413);
  const backup=(await req('/api/admin/export')).body;
  const bad=structuredClone(backup);bad.kids.push({...bad.kids[0],id:999});
  assert.equal((await req('/api/admin/import',bad)).status,400);
  assert.deepEqual({...((await req('/api/admin/export')).body),exported_at:''},{...backup,exported_at:''});
});
test('empty export/import roundtrip and family deletion require fresh PIN and exact confirmation',async t=>{
  const f=emptyFixture(t);await f.req('/api/families',{name:'Our family',pin:'1234'});
  const backup=(await f.req('/api/admin/export')).body;
  assert.equal((await f.req('/api/admin/import',backup)).status,200);
  assert.deepEqual({...((await f.req('/api/admin/export')).body),exported_at:''},{...backup,exported_at:''});
  assert.equal((await f.req('/api/admin/delete-family',{pin:'0000',confirmation:'Our family'})).status,401);
  assert.equal((await f.req('/api/admin/delete-family',{pin:'1234',confirmation:'wrong'})).status,400);
  const old=f.getCookie();assert.equal((await f.req('/api/admin/delete-family',{pin:'1234',confirmation:'Our family'})).status,200);
  f.setCookie(old);assert.equal((await f.req('/api/state')).status,404);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM family').get().n,0);
});
test('removing a kid removes their content/history but preserves siblings',async t=>{
  const {req}=await fixture(t);await req('/api/parent/unlock',{pin:'5678'});
  assert.equal((await req('/api/admin/remove-kid',{id:1})).status,200);
  const state=(await req('/api/state?kid=1')).body;assert.equal(state.kids.length,1);assert.equal(state.kids[0].name,'Sam');assert.equal(state.lists.length,0);
});
test('HTML and share routes carry strict security headers',async t=>{
  const f=emptyFixture(t);for(const path of ['/','/privacy','/f/amberapple-aquaapple-blueapple-0000']) {
    const r=await f.req(path);assert.equal(r.status,200);assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  }
});
test('attempt retention prunes the combined spelling/verse history to newest 50000 rows',async t=>{
  const f=await fixture(t),{req,db}=f;
  db.exec(`INSERT INTO sessions(id,kid_id,list_id,kind,created_at) VALUES('historical',1,1,'spelling','2020-01-01');
    WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<50000)
    INSERT INTO attempts(kid_id,list_id,word_id,word,typed,correct,first_try,created_at,session_id)
    SELECT 1,1,1,'friend','friend',1,1,'2020-01-01','historical' FROM seq;
    INSERT INTO verse_attempts(kid_id,verse_id,mode,level,typed,accuracy,created_at,session_id) VALUES(1,1,'read',0,'',0,'2025-01-01','historical');`);
  const session=(await req('/api/sessions',{kid_id:1,list_id:1,kind:'spelling'})).body;
  assert.equal((await req('/api/attempts',{session_id:session.id,word_id:1,typed:'friend'})).status,200);
  assert.equal(db.prepare('SELECT (SELECT COUNT(*) FROM attempts)+(SELECT COUNT(*) FROM verse_attempts) n').get().n,50000);
  assert.equal(db.prepare('SELECT MIN(id) n FROM attempts').get().n,3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM verse_attempts').get().n,1);
});
test('import enforces normal word/sentence/profile field lengths, not just request size',async t=>{
  const {req}=await fixture(t);await req('/api/parent/unlock',{pin:'5678'});
  const backup=(await req('/api/admin/export')).body;
  for(const [table,key,length] of [['words','word',101],['words','sentence',501],['kids','name',61],['verses','reference',121]]) {
    const bad=structuredClone(backup);bad[table][0][key]='a'.repeat(length);
    assert.equal((await req('/api/admin/import',bad)).status,400);
  }
});
test('kid-level empty-session spam is bounded without deleting attempt-backed practice',async t=>{
  const {req,db}=await fixture(t);
  const practiced=(await req('/api/sessions',{kid_id:1,list_id:1,kind:'spelling'})).body;
  await req('/api/attempts',{session_id:practiced.id,word_id:1,typed:'friend'});
  for(let i=0;i<105;i++)assert.equal((await req('/api/sessions',{kid_id:1,kind:'verse'})).status,201);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,101);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE id=?').get(practiced.id).n,1);
  await req('/api/parent/unlock',{pin:'5678'});
  const bad=(await req('/api/admin/export')).body;
  bad.sessions.push({...bad.sessions.find(s=>s.kind==='verse'),id:'one-too-many-empty'});
  assert.equal((await req('/api/admin/import',bad)).status,400);
});
