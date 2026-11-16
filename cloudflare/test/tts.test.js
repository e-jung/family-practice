import {defaults} from '../settings.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyFixture} from '../fixture-support.js';
import {audioBytes,TTS_MODEL,TTS_SPEAKER,MAX_CLIP_BYTES,isMP3} from '../tts.js';
import {sha256} from '../auth.js';

async function setup(t) {
  const f=emptyFixture(t);await f.req('/api/families',{name:'Voice',pin:'1234'});
  const entries=new Map();let calls=0;
  const old=globalThis.caches;
  globalThis.caches={default:{async match(key){return entries.get(key.url)?.clone();},async put(key,value){entries.set(key.url,value.clone());}}};
  t.after(()=>{globalThis.caches=old;});
  f.env.AI={async run(model,input){calls++;assert.equal(model,TTS_MODEL);assert.equal(input.speaker,f.env.TTS_SPEAKER || TTS_SPEAKER);assert.equal(input.encoding,'mp3');assert.equal(typeof input.text,'string');assert.equal(input.prompt,undefined);return {audio:btoa('ID3mock MP3')};}};
  return Object.assign(f,{entries,getCalls:()=>calls});
}

test('TTS validates family before cache, trims text, shares cached bytes across families',async t=>{
  const f=await setup(t);
  const first=await f.req('/api/tts?text=%20hello%20&lang=en');
  assert.equal(first.status,200);assert.equal(first.body,'ID3mock MP3');assert.equal(first.headers.get('content-type'),'audio/mpeg');assert.match(first.headers.get('cache-control'),/public.*31536000.*immutable/);
  assert.equal((await f.req('/api/tts?text=hello')).status,200);assert.equal(f.getCalls(),1);
  assert.deepEqual([...f.entries.keys()],['https://tts-cache.internal/v2/'+await sha256(TTS_MODEL+'|asteria|mp3|en|hello')]);
  await f.req('/api/families',{pin:'1234'});
  assert.equal((await f.req('/api/tts?text=hello')).status,200);assert.equal(f.getCalls(),1);
  const db=f.databases.get('registry').db;

  assert.equal(db.prepare("SELECT count FROM limits WHERE key LIKE 'tts:global:%:chars'").get().count,5);
  f.setCode('');assert.equal((await f.req('/api/tts?text=hello')).status,404);
  f.setCode('amberapple-aquaapple-blueapple-0000');assert.equal((await f.req('/api/tts?text=hello')).status,404);assert.equal(f.getCalls(),1);
});
test('TTS rejects empty, oversized, unsupported language; accepts 300 characters',async t=>{
  const f=await setup(t);
  for(const query of ['', '?text=%20%20','?text='+ 'x'.repeat(defaults.voice.request+1),
'?text=hello&lang=fr'])assert.equal((await f.req('/api/tts'+query)).status,400);

  assert.equal(f.getCalls(),0);assert.equal((await f.req('/api/tts?text='+ 'x'.repeat(defaults.voice.request))).status,200);
});
test('TTS deduplicates concurrent identical synthesis and quota reservations',async t=>{
  const f=await setup(t);let calls=0;
  f.env.AI.run=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,40));return {audio:btoa('ID3same')};};
  const result=await Promise.all(Array.from({length:8},()=>f.req('/api/tts?text=concurrent')));
  assert.ok(result.every(r=>r.status===200&&r.body==='ID3same'));assert.equal(calls,1);
});
test('TTS global, family and hashed-IP character caps do not block cached speech',async t=>{
  const f=await setup(t);await f.req('/api/tts?text=cached');
  const db=f.databases.get('registry').db;
  for(const [pattern,count] of [["tts:global:%",defaults.voice.globalDaily],["tts:family:%",defaults.voice.familyDaily],["tts:ip:%",defaults.voice.ipHourly]]) {
    db.prepare('UPDATE limits SET count=? WHERE key LIKE ?').run(count,pattern);
    const result=await f.req('/api/tts?text=new-'+count);assert.equal(result.status,429);assert.equal(result.body.error,'voice_quota');
    assert.equal((await f.req('/api/tts?text=cached')).status,200);
    db.exec("UPDATE limits SET count=1 WHERE key LIKE 'tts:%'");
  }
  assert.equal(f.getCalls(),1);
  db.exec("UPDATE limits SET until=0 WHERE key LIKE 'tts:%'");
  assert.equal((await f.req('/api/tts?text=after-expiry')).status,200);
});
test('TTS missing binding, model rejection, malformed or empty audio return 503 without caching',async t=>{
  const f=await setup(t);delete f.env.AI;
  assert.equal((await f.req('/api/tts?text=unavailable')).status,503);
  for(const output of [null,{}, {audio:''}, {audio:'%%%'}, {audio:btoa('not MP3')}, {audio:btoa('ID3'+'x'.repeat(MAX_CLIP_BYTES))}]) {
    f.env.AI={run:async()=>output};assert.equal((await f.req('/api/tts?text=unavailable')).status,503);
  }
  f.env.AI={run:async()=>{throw Error('model down');}};assert.equal((await f.req('/api/tts?text=unavailable')).status,503);assert.equal(f.entries.size,0);
});
test('TTS accepts documented JSON and defensive binary, stream and Response output shapes',async()=>{
  for(const output of [{audio:btoa('audio')},new TextEncoder().encode('audio'),new TextEncoder().encode('audio').buffer,new Blob(['audio']).stream(),new Response('audio'),Response.json({audio:btoa('audio')})]) {
    assert.equal(new TextDecoder().decode(await audioBytes(output)),'audio');
  }
});

test('TTS times out a stalled model and never caches its late result',async t=>{
  const f=await setup(t);f.env.AI.run=()=>new Promise(()=>{});
  const start=Date.now(),result=await f.req('/api/tts?text=timeout');
  assert.equal(result.status,503);assert.ok(Date.now()-start<6000);assert.equal(f.entries.size,0);
});

test('MP3 signatures accept ID3 and MPEG frame sync, reject other payloads',()=>{
  for(const bytes of [new Uint8Array([255,251,0]),new TextEncoder().encode('ID3audio')]) assert.ok(isMP3(bytes));
  for(const bytes of [new Uint8Array(),new Uint8Array([255,0]),new TextEncoder().encode('JSON')]) assert.ok(!isMP3(bytes));
});
test('Durable cache repopulates edge cache across families without AI or quota, speaker separates keys',async t=>{
  const f=await setup(t);await f.req('/api/tts?text=durable');
  f.entries.clear();delete f.env.AI;
  await f.req('/api/families',{pin:'1234'});
  assert.equal((await f.req('/api/tts?text=durable')).status,200);
  assert.equal(f.entries.size,1);assert.equal(f.getCalls(),1);
  f.env.TTS_SPEAKER='luna';
  assert.equal((await f.req('/api/tts?text=durable')).status,503);
});
test('Durable cache miss, LRU eviction, replacement accounting and clip validation',async t=>{
  const f=await setup(t),cache=f.env.TTS_CACHE.get('tts-cache');cache.maxBytes=12;
  const key=n=>'https://internal/'+String(n).repeat(64);
  const put=(n,body='ID3abc')=>cache.fetch(new Request(key(n),{method:'PUT',body}));
  const get=n=>cache.fetch(new Request(key(n)));
  assert.equal((await get(1)).status,404);
  await put(1);await put(2);
  f.databases.get('tts-cache').db.prepare('UPDATE tts_cache SET last_used=0 WHERE key=?').run('2'.repeat(64));
  assert.equal((await get(1)).status,200);await put(3);
  assert.equal((await get(2)).status,404);assert.equal((await get(1)).status,200);assert.equal((await get(3)).status,200);
  await put(1,'ID3');assert.equal(f.databases.get('tts-cache').db.prepare('SELECT SUM(bytes) AS n FROM tts_cache').get().n,9);
  assert.equal((await put(4,'bad')).status,400);
  assert.equal((await put(4,'ID3'+'x'.repeat(MAX_CLIP_BYTES))).status,413);
});
test('Character quota allows exact limit, rejects overshoot atomically and resets at UTC midnight/hour expiry',async t=>{
  const f=await setup(t);await f.req('/api/tts?text=seed');
  const db=f.databases.get('registry').db;
  for(const [pattern,cap] of [
    ['tts:global:%',defaults.voice.globalDaily], ['tts:family:%',defaults.voice.familyDaily],
    ['tts:ip:%',defaults.voice.ipHourly],
  ]) {
    db.exec("UPDATE limits SET count=0 WHERE key LIKE 'tts:%'");
    db.prepare('UPDATE limits SET count=? WHERE key LIKE ?').run(cap-3,pattern);
    assert.equal((await f.req('/api/tts?text='+encodeURIComponent(pattern))).status,429);
    const before=db.prepare("SELECT SUM(count) AS n FROM limits WHERE key LIKE 'tts:%'").get().n;assert.equal(before,cap-3);
    assert.equal((await f.req('/api/tts?text=abc')).status,200);
    f.entries.clear();f.databases.get('tts-cache').db.exec('DELETE FROM tts_cache');
    assert.equal((await f.req('/api/tts?text=z')).status,429);
  }
  const day=new Date().toISOString().slice(0,10);
  assert.equal(db.prepare("SELECT until FROM limits WHERE key LIKE 'tts:global:%'").get().until,Date.parse(day+'T00:00:00Z')+86400000);
  db.exec("UPDATE limits SET until=0 WHERE key LIKE 'tts:%'");
  assert.equal((await f.req('/api/tts?text=reset')).status,200);
});
test('Aura stream, Response, binary and base64 JSON are validated and cached end-to-end',async t=>{
  const f=await setup(t),bytes=new Uint8Array([255,251,65,66]);
  const outputs=[new Blob([bytes]).stream(),new Response(bytes),bytes.buffer,Response.json({audio:btoa('ID3json')})];
  for(const [index,output] of outputs.entries()) {
    f.env.AI.run=async(model,input)=>{assert.equal(model,'@cf/deepgram/aura-1');assert.deepEqual(input,{text:'shape'+index,speaker:'asteria',encoding:'mp3'});return output;};
    assert.equal((await f.req('/api/tts?text=shape'+index)).status,200);
  }
  assert.equal(f.entries.size,4);assert.equal(f.databases.get('tts-cache').db.prepare('SELECT COUNT(*) AS n FROM tts_cache').get().n,4);
});
test('Cache outages leave voice usable and do not bypass quota',async t=>{
  const f=await setup(t);
  globalThis.caches.default={match(){throw Error('edge down');},put(){throw Error('edge down');}};
  f.env.TTS_CACHE={idFromName:n=>n,get:()=>({fetch(){throw Error('DO down');}})};
  assert.equal((await f.req('/api/tts?text=outage')).status,200);
  f.databases.get('registry').db.prepare("UPDATE limits SET count=? WHERE key LIKE 'tts:global:%'").run(defaults.voice.globalDaily);
  assert.equal((await f.req('/api/tts?text=outage')).status,429);assert.equal(f.getCalls(),1);
});
