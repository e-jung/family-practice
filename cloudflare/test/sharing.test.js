import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {emptyFixture} from '../fixture-support.js';
import worker,{ShareStore} from '../worker.js';
import {ownerHash,safeSnapshot,validSlug,generateShareSlug,sharedSlug} from '../sharing.js';
import {sha256} from '../auth.js';

async function setup(t) {
 const f=emptyFixture(t),db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const sql={exec(q,...args){if(!args.length&&q.includes(';')){db.exec(q);return [];}const stmt=db.prepare(q);if(stmt.columns().length)return stmt.all(...args);stmt.run(...args);return [];}};
 const store=new ShareStore({storage:{sql},blockConcurrencyWhile:fn=>fn()});let reads=0;
 f.env.SHARES={idFromName:n=>n,get:()=>({fetch:r=>{if(['/read','/latest'].includes(new URL(r.url).pathname))reads++;return store.fetch(r);}})};
 await f.req('/api/families',{name:'Private family',pin:'5678'});
 for(const name of ['Alex','Sam'])await f.req('/api/admin/kids',{name});
 const list=(await f.req('/api/admin/lists',{kid_id:1,title:'Kind words',date:'2026-11-14',words:[{word:'kind',sentence:'Be kind.'},{word:'light'}]})).body.id;
 const verse=(await f.req('/api/admin/verses',{kid_id:1,reference:'John 11:35',text:'Jesus wept.',translation:'KJV'})).body.id;
 async function raw(path,{method='GET',data,code=f.getCode(),cookie=f.getCookie(),headers={}}={}) {
  const response=await worker.fetch(new Request('https://family.example'+path,{method,headers:{'X-Family-Code':code,cookie,...(data===undefined?{}:{'Content-Type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)}),f.env);
  return {status:response.status,headers:response.headers,body:response.headers.get('Content-Type')?.includes('json')?await response.json():await response.text()};
 }
 return {f,db,store,list,verse,raw,get reads(){return reads;}};
}
const ok=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.body;};

test('shares are immutable allowlisted snapshots, unlisted/noindex, parent-managed and HMAC-owned',async t=>{
 const {f,db,list,verse,raw}=await setup(t);
 const made=ok(await f.req('/api/admin/shares',{list_id:list,verse_id:verse,note:'Practice kindly'})),slug=made.share.slug;
 assert.ok(validSlug(slug));assert.equal(made.url,'/s/'+slug);
 const stored=db.prepare('SELECT * FROM shared_items').get();assert.equal(stored.owner,await ownerHash(f.env.SESSION_SECRET,await sha256(f.getCode())));assert.notEqual(stored.owner,await sha256(f.getCode()));
 const publicRead=await raw('/api/share/'+slug,{code:'',cookie:''});assert.equal(publicRead.status,200);assert.match(publicRead.headers.get('X-Robots-Tag'),/noindex/);assert.equal(publicRead.headers.get('Cache-Control'),'no-store');
 assert.equal(publicRead.body.share.note,'Practice kindly');assert.equal(publicRead.body.share.verse.due_date,undefined);
 const serialized=JSON.stringify(publicRead.body);for(const privateValue of [f.getCode(),'Private family','Alex','kid_id','owner','pin_hash','list_id'])assert.ok(!serialized.includes(privateValue),privateValue);
 assert.deepEqual(publicRead.body.share.words,[{word:'kind',sentence:'Be kind.'},{word:'light',sentence:''}]);
 await f.req('/api/admin/lists',{id:list,kid_id:1,title:'Changed',words:[{word:'new'}]});assert.equal(ok(await raw('/api/share/'+slug)).share.title,'Kind words');
 assert.equal((await raw('/api/class/'+slug)).status,404);
 assert.equal((await raw('/s/'+slug)).status,200);assert.match((await raw('/c/'+slug)).headers.get('X-Robots-Tag'),/noindex/);
 await f.req('/api/parent/lock',{});assert.equal((await f.req('/api/admin/shares')).status,401);assert.equal((await f.req('/api/admin/shares/'+slug+'/stop',{})).status,401);
 const ownerCode=f.getCode(),ownerCookie=f.getCookie();await f.req('/api/families',{name:'Other',pin:'1234'});
 assert.deepEqual(ok(await f.req('/api/admin/shares')).shares,[]);assert.equal((await f.req('/api/admin/shares/'+slug+'/stop',{})).status,404);
 f.setCode(ownerCode);f.setCookie(ownerCookie);await f.req('/api/parent/unlock',{pin:'5678'});
 ok(await f.req('/api/admin/shares/'+slug+'/stop',{}));assert.equal((await raw('/api/share/'+slug)).status,410);
 assert.equal(ok(await f.req('/api/admin/shares')).shares[0].stopped,true);
});

test('class publication, local editable multi-kid imports, verse deduplication, and per-kid follows',async t=>{
 const x=await setup(t),{f,list,verse,raw}=x;
 const slug=ok(await f.req('/api/admin/classes',{name:'Weekly words'})).class.slug;
 const first=ok(await f.req('/api/admin/classes/'+slug+'/publish',{list_id:list,verse_id:verse})).week;
 ok(await f.req('/api/admin/follows',{slug,kids:[1,2],include_verse:true}));
 const cachedReads=x.reads;
 let follow=ok(await f.req('/api/follows')).follows[0];assert.equal(x.reads,cachedReads);assert.equal(follow.latest.week_id,first.week_id);assert.deepEqual(follow.last_imported,{});
 const imported=ok(await f.req('/api/admin/import-shared',{slug,kids:[1,2],include_verse:true}));assert.equal(imported.lists.length,2);assert.equal(imported.verses.length,1);assert.deepEqual(imported.skipped_verses,[1]);
 const copy=f.db.prepare('SELECT * FROM lists WHERE id=?').get(imported.lists[1].list_id);assert.equal(copy.source_slug,slug);assert.equal(copy.source_week_id,first.week_id);assert.equal(copy.kid_id,2);
 follow=ok(await f.req('/api/follows')).follows[0];assert.deepEqual(follow.last_imported,{'1':first.week_id,'2':first.week_id});
 const repeat=ok(await f.req('/api/admin/import-shared',{slug,kids:[2],include_verse:true}));assert.notEqual(repeat.lists[0].list_id,copy.id);assert.deepEqual(repeat.skipped_verses,[2]);
 ok(await f.req('/api/admin/lists',{id:list,kid_id:1,title:'Next week',words:[{word:'hope'}]}));
 assert.equal((await f.req('/api/admin/classes/'+slug+'/publish',{list_id:list})).status,429);
 x.db.prepare('UPDATE shared_weeks SET published_at=? WHERE slug=?').run(new Date(Date.now()-600001).toISOString(),slug);
 const second=ok(await f.req('/api/admin/classes/'+slug+'/publish',{list_id:list})).week;
 follow=ok(await f.req('/api/follows')).follows[0];assert.equal(follow.latest.week_id,second.week_id);assert.equal(follow.last_imported[2],first.week_id);
 ok(await f.req('/api/admin/import-shared',{slug,kids:[1],week_id:second.week_id}));follow=ok(await f.req('/api/follows')).follows[0];assert.equal(follow.last_imported[1],second.week_id);assert.equal(follow.last_imported[2],first.week_id);
 const publicClass=ok(await raw('/api/class/'+slug,{code:'',cookie:''}));assert.equal(publicClass.weeks.length,2);assert.equal(publicClass.class.followers,1);assert.equal(publicClass.latest.title,'Next week');
 ok(await raw('/api/admin/follows/'+slug,{method:'PATCH',data:{kids:[2],include_verse:false}}));assert.deepEqual(ok(await f.req('/api/follows')).follows[0].kids,[2]);
 assert.equal((await raw('/api/admin/follows/'+slug,{method:'PATCH',data:{kids:[999]}})).status,400);
 assert.equal((await raw('/api/admin/follows/'+slug,{method:'PATCH',data:{kids:[1]},headers:{Origin:'https://evil.example'}})).status,403);
 ok(await f.req('/api/admin/classes/'+slug+'/rename',{name:'Renamed'}));assert.equal(ok(await raw('/api/class/'+slug)).class.name,'Renamed');
 ok(await f.req('/api/admin/classes/'+slug+'/stop',{}));assert.equal((await f.req('/api/admin/import-shared',{slug,kids:[2]})).status,410);
 assert.equal(ok(await f.req('/api/follows?refresh=1')).follows[0].available,false);
 assert.equal(f.db.prepare('SELECT title FROM lists WHERE id=?').get(copy.id).title,'Kind words');
 ok(await raw('/api/admin/follows/'+slug,{method:'DELETE'}));assert.deepEqual(ok(await f.req('/api/follows')).follows,[]);
});

test('imports are atomic under family limits and old backups default new source fields',async t=>{
 const {f,list,verse}=await setup(t);const slug=ok(await f.req('/api/admin/shares',{list_id:list,verse_id:verse})).share.slug;
 for(let i=0;i<198;i++)f.db.prepare("INSERT INTO lists(kid_id,title,date) VALUES(1,'existing','2026-11-14')").run();
 const before=f.db.prepare('SELECT COUNT(*) n FROM lists').get().n;
 assert.equal((await f.req('/api/admin/import-shared',{slug,kids:[1,2],include_verse:true})).status,400);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM lists').get().n,before);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM shared_imports').get().n,0);
 const backup=ok(await f.req('/api/admin/export'));for(const row of [...backup.lists,...backup.verses]){delete row.source_slug;delete row.source_week_id;delete row.source_kind;delete row.source_note;delete row.source_class_name;}
 assert.equal((await f.req('/api/admin/import',backup)).status,200);
 assert.equal(f.db.prepare('SELECT source_slug FROM lists LIMIT 1').get().source_slug,'');
});

test('reports are anonymous aggregate counts, deduplicated per IP/day; creation and public-read limits persist',async t=>{
 const {f,db,list,raw}=await setup(t);const slug=ok(await f.req('/api/admin/shares',{list_id:list})).share.slug;
 for(let i=0;i<3;i++)ok(await raw('/api/report/'+slug,{method:'POST',data:{},code:'',cookie:''}));
 assert.equal(db.prepare('SELECT reports FROM shared_items').get().reports,1);
 ok(await raw('/api/report/'+slug,{method:'POST',data:{},headers:{'CF-Connecting-IP':'198.51.100.8'}}));assert.equal(db.prepare('SELECT reports FROM shared_items').get().reports,2);
 for(let i=0;i<117;i++)assert.equal((await raw('/api/share/'+slug,{code:'',cookie:''})).status,200);
 assert.equal((await raw('/api/share/'+slug,{code:'',cookie:''})).status,429);
 assert.equal((await raw('/api/share/'+slug,{code:'',cookie:'',headers:{'CF-Connecting-IP':'198.51.100.9'}})).status,200);
 for(let i=0;i<19;i++)ok(await f.req('/api/admin/shares',{list_id:list}));assert.equal((await f.req('/api/admin/shares',{list_id:list})).status,429);
 const registry=[...f.databases].find(([k])=>k==='registry')[1].db;
 assert.ok(registry.prepare("SELECT key FROM limits WHERE key LIKE 'sharing:create:%'").get());
 registry.prepare("UPDATE limits SET until=0 WHERE key LIKE 'sharing:%'").run();ok(await f.req('/api/admin/classes',{name:'After expiry'}));
});

test('import IP limits cover parent and MCP; shared MCP read is available to read-only without import rights',async t=>{
 const {f,list,raw}=await setup(t);const slug=ok(await f.req('/api/admin/shares',{list_id:list})).share.slug;
 const token=ok(await f.req('/api/admin/connections',{name:'Reader',scope:'read-only'})).token;
 const call=async(token,name,args)=>{const response=await worker.fetch(new Request('https://family.example/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),f.env);return {status:response.status,body:await response.json()};};
 const shared=await call(token,'get_shared_list',{url_or_slug:'https://family.example/s/'+slug});assert.equal(shared.body.result.structuredContent.snapshot.title,'Kind words');
 assert.equal((await call(token,'import_shared_list',{url_or_slug:slug,kids:[2]})).body.result.isError,true);
 const writer=ok(await f.req('/api/admin/connections',{name:'Writer'})).token;
 assert.equal((await call(writer,'import_shared_list',{url_or_slug:slug,kids:[2],include_verse:false})).body.result.structuredContent.lists.length,1);
 for(let i=0;i<59;i++)ok(await f.req('/api/admin/import-shared',{slug,kids:[2]}));
 assert.equal((await f.req('/api/admin/import-shared',{slug,kids:[2]})).status,429);
 assert.equal((await call(writer,'import_shared_list',{url_or_slug:slug,kids:[2]})).body.result.isError,true);
 ok(await raw('/api/admin/import-shared',{method:'POST',data:{slug,kids:[2]},headers:{'CF-Connecting-IP':'198.51.100.3'}}));
});

test('family deletion stops owned links and removes follower registrations, but copied content belongs to receiver',async t=>{
 const {f,list,raw}=await setup(t);const slug=ok(await f.req('/api/admin/classes',{name:'Weekly'})).class.slug;ok(await f.req('/api/admin/classes/'+slug+'/publish',{list_id:list}));
 const ownerCode=f.getCode(),ownerCookie=f.getCookie();await f.req('/api/families',{name:'Receiver',pin:'1234'});await f.req('/api/admin/kids',{name:'Child'});
 ok(await f.req('/api/admin/follows',{slug,kids:[1]}));const copy=ok(await f.req('/api/admin/import-shared',{slug,kids:[1]}));const receiverCode=f.getCode(),receiverCookie=f.getCookie();
 f.setCode(ownerCode);f.setCookie(ownerCookie);ok(await f.req('/api/admin/delete-family',{pin:'5678',confirmation:'Private family'}));assert.equal((await raw('/api/class/'+slug)).status,410);
 f.setCode(receiverCode);f.setCookie(receiverCookie);assert.equal(ok(await f.req('/api/state?kid=1')).lists[0].id,copy.lists[0].list_id);
});

test('snapshot validation strips identifiers and rejects malformed/oversized content',()=>{
 assert.deepEqual(safeSnapshot({title:'Week',words:[{word:'kind',id:1,kid_id:3}],family:'secret',name:'Private'}),{title:'Week',date:'',note:'',words:[{word:'kind',sentence:''}]});
 for(const b of [{title:'x',words:[]},{title:'x',words:Array(101).fill({word:'x'})},{title:'x',words:[{word:'x'.repeat(101)}]},{title:'x',words:[{word:'x'}],verse:{reference:'r',text:'x'.repeat(2001)}},{title:'x',words:[{word:'x'}],date:'2026-02-30'}])assert.throws(()=>safeSnapshot(b));
});

test('class caps, publish pacing and retention are enforced server-side; foreign-kid verses and long notes are rejected',async t=>{
 const {f,db,list,verse}=await setup(t);
 assert.equal((await f.req('/api/admin/shares',{list_id:list,note:'x'.repeat(141)})).status,400);
 const otherVerse=ok(await f.req('/api/admin/verses',{kid_id:2,reference:'John 11:35',text:'Jesus wept.',translation:'Other'})).id;
 assert.equal((await f.req('/api/admin/shares',{list_id:list,verse_id:otherVerse})).status,404);
 const slug=ok(await f.req('/api/admin/classes',{name:'First'})).class.slug;
 for(let i=0;i<4;i++)ok(await f.req('/api/admin/classes',{name:'Class '+i}));assert.equal((await f.req('/api/admin/classes',{name:'Sixth'})).status,400);
 ok(await f.req('/api/admin/classes/'+slug+'/publish',{list_id:list,verse_id:verse}));
 assert.equal((await f.req('/api/admin/classes/'+slug+'/publish',{list_id:list})).status,429);
 // Populate historical weeks directly rather than advancing a real clock or issuing 200 requests.
 const snapshot=JSON.stringify({title:'Older',date:'2026-11-14',note:'',words:[{word:'kind',sentence:''}]});
 db.prepare('UPDATE shared_weeks SET published_at=?').run(new Date(Date.now()-600001).toISOString());
 for(let i=0;i<199;i++)db.prepare('INSERT INTO shared_weeks VALUES(?,?,?,?)').run('history-'+i,slug,snapshot,new Date(Date.now()-(i+2)*600001).toISOString());
 const latest=ok(await f.req('/api/admin/classes/'+slug+'/publish',{list_id:list})).week;
 assert.equal(db.prepare('SELECT COUNT(*) n FROM shared_weeks WHERE slug=?').get(slug).n,200);
 assert.equal(db.prepare('SELECT id FROM shared_weeks WHERE id=?').get(latest.week_id).id,latest.week_id);
 assert.equal(db.prepare('SELECT id FROM shared_weeks WHERE id=?').get('history-198'),undefined);
 assert.equal(ok(await f.req('/api/admin/classes')).classes.find(c=>c.slug===slug).week_count,200);
 ok(await f.req('/api/admin/classes/'+slug+'/stop',{}));ok(await f.req('/api/admin/classes',{name:'Replacement'}));
});

test('follow polling batches multiple classes into one store request and caches for ten minutes',async t=>{
 const x=await setup(t),{f,list}=x;
 const a=ok(await f.req('/api/admin/classes',{name:'A'})).class.slug,b=ok(await f.req('/api/admin/classes',{name:'B'})).class.slug;
 for(const slug of [a,b]){ok(await f.req('/api/admin/classes/'+slug+'/publish',{list_id:list}));ok(await f.req('/api/admin/follows',{slug,kids:[1]}));}
 let count=x.reads;ok(await f.req('/api/follows'));assert.equal(x.reads,count);
 f.db.prepare('UPDATE class_follows SET checked_at=0').run();const data=ok(await f.req('/api/follows'));assert.equal(data.follows.length,2);assert.equal(x.reads,count+1);
 count=x.reads;ok(await f.req('/api/follows'));assert.equal(x.reads,count);
 await f.req('/api/parent/lock',{});ok(await f.req('/api/follows?refresh=1'));assert.equal(x.reads,count,'kid refresh cannot bypass cache');
 await f.req('/api/parent/unlock',{pin:'5678'});ok(await f.req('/api/follows?refresh=1'));assert.equal(x.reads,count+1);
});

test('slugs have three curated compounds and base32 suffix, support URLs, and do not reuse family-code format',()=>{
 const generated=new Set();for(let i=0;i<100;i++){const slug=generateShareSlug();assert.ok(validSlug(slug));assert.equal(slug.split('-').length,4);assert.match(slug.split('-')[3],/^[a-z2-7]{4}$/);assert.equal(sharedSlug('https://family.example/s/'+slug),slug);assert.equal(sharedSlug(slug),slug);generated.add(slug);}assert.equal(generated.size,100);
 for(const bad of ['bad','../other','https://family.example/f/private','https://user:pass@family.example/s/anything'])assert.throws(()=>sharedSlug(bad));
});
