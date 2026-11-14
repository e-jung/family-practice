import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleWord, reviewBank, normalize, REVIEW_INTERVALS} from '../../lib/practice.js';
import {fixture} from '../fixture-support.js';
import {createHandler} from '../core.js';
const attempt=(extra={})=>({word:'Friend',word_id:1,list_id:1,mode:'test',step:0,correct:true,first_try:true,created_at:'2026-11-14T23:59:59Z',...extra});
test('Leitner promotes, caps, resets and schedules UTC calendar days',()=>{
  let w=scheduleWord(undefined,attempt());
  assert.equal(w.box,2);assert.equal(w.due,'2026-11-16');
  for (const box of [3,4,5,6,6]) {w=scheduleWord(w,attempt());assert.equal(w.box,box);assert.equal(w.due,new Date(Date.UTC(2026,10,14+REVIEW_INTERVALS[box-1])).toISOString().slice(0,10));}
  const retry=scheduleWord(w,attempt({first_try:false}));assert.equal(retry.box,6);
  w=scheduleWord(w,attempt({correct:false}));assert.equal(w.box,1);assert.equal(w.misses,1);assert.equal(w.due,'2026-11-15');
  w=scheduleWord(w,attempt({first_try:false}));assert.equal(w.box,1);
});
test('Learn only schedules recall, never promotes tested words, ignores skip',()=>{
  assert.equal(scheduleWord(undefined,attempt({mode:'learn',step:75})).box,1);
  let w=scheduleWord(undefined,attempt({mode:'learn',step:100}));assert.equal(w.box,2);assert.equal(w.tested,false);
  w=scheduleWord(w,attempt({mode:'learn',step:100}));assert.equal(w.box,2);
  assert.equal(scheduleWord(w,attempt({mode:'learn',step:'skip'})),w);
  w=scheduleWord(w,attempt());assert.equal(w.box,3);
  assert.equal(scheduleWord(w,attempt({mode:'learn',step:100})),w);
});
test('review queue caps at 15 and sorts lowest box then most misses',()=>{
  const entries=Array.from({length:20},(_,i)=>({key:String(i),box:i%6+1,misses:i,due:'2026-11-14'}));
  entries.push({key:'later',box:3,misses:0,due:'2026-11-16'});
  const result=reviewBank(entries,'2026-11-14T00:00:01Z');
  assert.equal(result.due.length,15);assert.equal(result.due[0].key,'18');assert.equal(result.nextDue,'2026-11-16');assert.equal(result.dueSoon.length,1);
  assert.equal(Object.values(result.counts).reduce((a,b)=>a+b),21);
});
test('backend normalizes across lists, isolates kids and supports cross-list review rounds',async t=>{
  const f=await fixture(t);
  const list=(await f.req('/api/state?kid=1')).body.lists[0], w=list.words[0];
  const send=async (word,kind='spelling',typed=word.word,step=0)=>{
    const session=(await f.req('/api/sessions',{kid_id:1,kind,word_ids:[word.id]})).body.id;
    assert.ok(session);
    const result=await f.req('/api/attempts',{session_id:session,word_id:word.id,typed,step});assert.equal(result.status,200);return session;
  };
  await send(w);
  await f.req('/api/parent/unlock',{pin:'5678'});
  const duplicate=(await f.req('/api/admin/lists',{kid_id:1,title:'Next week',words:[{word:'  '+w.word.toUpperCase()+'  '},{word:'other'}]})).body.id;
  const second=(await f.req('/api/state?kid=1')).body.lists.find(l=>l.id===duplicate).words;
  await send(second[0],'review');
  let bank=(await f.req('/api/review?kid=1')).body;
  assert.equal(bank.words.length,1);assert.equal(bank.words[0].box,3);assert.equal(bank.words[0].word_id,second[0].id);assert.equal(bank.words[0].key,normalize(w.word));
  assert.deepEqual((await f.req('/api/progress?kid=1')).body.wordBank,bank);
  assert.equal((await f.req('/api/review?kid=2')).body.words.length,0);
  const review=(await f.req('/api/sessions',{kid_id:1,kind:'review',word_ids:[w.id,second[1].id]})).body.id;
  for(const word of [w,second[1]]) assert.equal((await f.req('/api/attempts',{session_id:review,word_id:word.id,typed:word.word})).status,200);
  assert.equal((await f.req('/api/sessions/complete',{session_id:review})).status,200);
  assert.equal((await f.req('/api/sessions',{kid_id:1,kind:'review',list_id:list.id,word_ids:[w.id]})).status,400);
  assert.equal((await f.req('/api/admin/archive',{type:'lists',id:list.id})).status,200);
  assert.equal((await f.req('/api/admin/archive',{type:'lists',id:duplicate})).status,200);
  const historical=(await f.req('/api/review?kid=1')).body.words;
  assert.equal(historical.length,2);
  assert.equal((await f.req('/api/sessions',{kid_id:1,kind:'review',word_ids:historical.map(w=>w.word_id)})).status,201);
  f.db.prepare("UPDATE word_bank SET due='2000-01-01'").run();
  assert.equal((await f.req('/api/review?kid=1')).body.due.length,2);
  // Roundtrip preserves scheduling even after attempt retention removes source history.
  f.db.prepare('DELETE FROM attempts').run();
  const backup=(await f.req('/api/admin/export')).body;
  assert.equal((await f.req('/api/admin/import',backup)).status,200);
  assert.equal((await f.req('/api/review?kid=1')).body.words.length,2);
});
test('skip marker never consumes a real recall try; explicit abandonment permits early test',async t=>{
  const f=await fixture(t), list=(await f.req('/api/state?kid=1')).body.lists[0],w=list.words[0];
  const session=(await f.req('/api/sessions',{kid_id:1,kind:'learn',word_ids:[w.id]})).body.id;
  const send=step=>f.req('/api/attempts',{session_id:session,word_id:w.id,typed:w.word,step});
  assert.equal((await send('skip')).body.first_try,false);
  assert.equal(f.db.prepare('SELECT correct,first_try FROM attempts').get().correct,0);
  assert.equal((await f.req('/api/review?kid=1')).body.words.length,0);
  const progress=(await f.req('/api/progress?kid=1')).body;
  assert.equal(progress.learning.attempts,0);assert.equal(progress.learning.skips,1);assert.equal(progress.learning.wordsLearned,0);
  assert.equal((await send(100)).body.first_try,true);
  assert.equal((await f.req('/api/review?kid=1')).body.words[0].box,2);
  const early=(await f.req('/api/sessions',{kid_id:1,kind:'learn',word_ids:[w.id]})).body.id;
  assert.equal((await f.req('/api/sessions/complete',{session_id:early})).status,400);
  assert.equal((await f.req('/api/sessions/complete',{session_id:early,abandoned:true})).status,200);
});
test('id-ordered backfill runs once and repeated initialization preserves bank',async t=>{
  const f=await fixture(t),list=(await f.req('/api/state?kid=1')).body.lists[0],w=list.words[0];
  const sess=(await f.req('/api/sessions',{kid_id:1,kind:'spelling',word_ids:[w.id]})).body.id;
  await f.req('/api/attempts',{session_id:sess,word_id:w.id,typed:'wrong'});
  await f.req('/api/attempts',{session_id:sess,word_id:w.id,typed:w.word});
  const live=f.db.prepare('SELECT * FROM word_bank').all();
  f.db.prepare('DELETE FROM word_bank').run();f.db.prepare("DELETE FROM settings WHERE key='srs_backfill_v1'").run();
  // Replay with the real storage adapter, without starting a second Worker instance.
  const sql={exec(query,...args){if(!args.length&&query.includes(';')){f.db.exec(query);return [];}const st=f.db.prepare(query);if(st.columns().length)return st.all(...args);st.run(...args);return [];}};
  const ctx={storage:{sql,transactionSync(fn){f.db.exec('BEGIN');try{const v=fn();f.db.exec('COMMIT');return v;}catch(e){f.db.exec('ROLLBACK');throw e;}}}};
  createHandler(ctx,f.env);
  assert.deepEqual(f.db.prepare('SELECT * FROM word_bank').all(),live,'deterministic historical replay equals live updates, including counters and metadata');
  assert.equal(f.db.prepare('SELECT box FROM word_bank').get().box,1);
  assert.equal(f.db.prepare('SELECT misses FROM word_bank').get().misses,1);
  f.db.prepare('UPDATE word_bank SET box=6').run();createHandler(ctx,f.env);
  assert.equal(f.db.prepare('SELECT box FROM word_bank').get().box,6);
});

test('word bank stores honest exposure counters and latest sentence; struggling means box 1 with two misses',()=>{
  let w=scheduleWord(undefined,attempt({mode:'learn',step:0,sentence:'A good friend.'}));
  assert.equal(w.box,1); assert.equal(w.seen,0); assert.equal(w.last_result,'learning');
  assert.deepEqual(scheduleWord(w,attempt({mode:'learn',step:'skip'})),w);
  w=scheduleWord(w,attempt({mode:'learn',step:100,sentence:'My friend is here.'}));
  assert.equal(w.box,2); assert.equal(w.seen,1); assert.equal(w.first_try_correct,1);
  assert.equal(w.sentence,'My friend is here.');
  w=scheduleWord(w,attempt({correct:false}));
  assert.equal(reviewBank([w],'2026-11-15').struggling.length,0);
  w=scheduleWord(w,attempt({correct:false,first_try:false}));
  assert.equal(w.misses,2); assert.equal(w.seen,3); assert.equal(w.last_result,'miss');
  assert.equal(reviewBank([w],'2026-11-15').struggling.length,1);
  w=scheduleWord(w,attempt({first_try:false}));
  assert.equal(w.box,1); assert.equal(w.first_try_correct,1); assert.equal(w.last_result,'retry_correct');
});
