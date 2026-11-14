import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../fixture-support.js';
import worker,{FamilyDatabase} from '../worker.js';
import {sha256} from '../auth.js';
import {MCP_VERSION} from '../mcp.js';

async function setup(t) {
 const f=await fixture(t);await f.req('/api/parent/unlock',{pin:'5678'});
 async function connection(scope='add-read',name='My assistant') {const r=await f.req('/api/admin/connections',{name,scope});assert.equal(r.status,201);return r.body;}
 async function raw(token,body,{method='POST',headers={}}={}) {
  const r=await worker.fetch(new Request('https://family.example/mcp',{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),f.env);
  return {status:r.status,headers:r.headers,body:await r.text().then(text=>text?JSON.parse(text):null)};
 }
 const rpc=(token,method,params={},options)=>raw(token,{jsonrpc:'2.0',id:1,method,params},options);
 const call=(token,name,args={})=>rpc(token,'tools/call',{name,arguments:args});
 return {...f,f,connection,raw,rpc,call};
}
const result=r=>{assert.equal(r.status,200);assert.ok(r.body.result);assert.ok(!r.body.result.isError,JSON.stringify(r.body));return JSON.parse(r.body.result.content[0].text);};

test('parent connections are bounded, family-bound, hash-only, never exported and revoke immediately',async t=>{
 const {f,connection,call}=await setup(t);
 await f.req('/api/parent/lock',{});
 for(const [path,data] of [['/api/admin/connections',undefined],['/api/admin/connections',{name:'x'}],['/api/admin/connections/revoke',{id:'x'}],['/api/admin/connections/revoke-all',{}]])assert.equal((await f.req(path,data)).status,401);
 await f.req('/api/parent/unlock',{pin:'5678'});
 for(const body of [{},{name:''},{name:'x'.repeat(81)},{name:'x',scope:'admin'},{name:'x',token:'user supplied'}])assert.equal((await f.req('/api/admin/connections',body)).status,400);
 const first=await connection();assert.match(first.token,/^fp_[a-f0-9]{64}_[a-f0-9]{64}$/);
 const stored=f.db.prepare('SELECT * FROM mcp_connections').get();assert.equal(stored.token_hash,await sha256(first.token));assert.equal(Object.values(stored).includes(first.token),false);
 const list=await f.req('/api/admin/connections');assert.deepEqual(list.body.connections,[first.connection]);assert.ok(!JSON.stringify(list.body).includes('token'));
 assert.equal((await f.req('/api/admin/export')).body.mcp_connections,undefined);
 for(let i=0;i<4;i++)await connection();assert.equal((await f.req('/api/admin/connections',{name:'sixth'})).status,400);
 assert.equal(result(await call(first.token,'list_kids')).kids.length,2);
 assert.ok((await f.req('/api/admin/connections')).body.connections.find(c=>c.id===first.connection.id).last_used_at);
 assert.equal((await f.req('/api/admin/connections/revoke',{id:first.connection.id})).status,200);
 assert.equal((await call(first.token,'list_kids')).status,401);
 await connection();assert.equal((await f.req('/api/admin/connections/revoke-all',{})).status,200);assert.deepEqual((await f.req('/api/admin/connections')).body.connections,[]);
});

test('Streamable HTTP initialization, negotiation, notifications, ping and protocol errors',async t=>{
 const {connection,rpc,raw}=await setup(t);const {token}=await connection();
 const init=version=>rpc(token,'initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'Test',version:'1'}});
 assert.equal((await init(MCP_VERSION)).body.result.protocolVersion,MCP_VERSION);
 assert.equal((await init('2025-06-18')).body.result.protocolVersion,'2025-06-18');
 assert.equal((await init('1900-01-01')).body.result.protocolVersion,MCP_VERSION);
 assert.equal((await rpc(token,'initialize')).body.error.code,-32602);
 assert.deepEqual((await rpc(token,'ping')).body.result,{});
 const notified=await raw(token,{jsonrpc:'2.0',method:'notifications/initialized'});assert.equal(notified.status,202);assert.equal(notified.body,null);
 assert.equal((await rpc(token,'not/a/method')).body.error.code,-32601);
 for(const body of [[],[{jsonrpc:'2.0',id:1,method:'ping'}],null,42,{method:'ping'},{jsonrpc:'2.0',id:1,method:'ping',params:[]}])assert.equal((await raw(token,body)).body.error.code,-32600);
 assert.deepEqual((await raw(token,{jsonrpc:'2.0',id:null,method:'ping'})).body,{jsonrpc:'2.0',id:null,result:{}});
 assert.equal((await raw(token,'{')).body.error.code,-32700);
 assert.equal((await rpc(token,'ping',{}, {headers:{'MCP-Protocol-Version':'1900-01-01'}})).status,400);
 const tools=(await rpc(token,'tools/list')).body.result.tools;
 assert.deepEqual(tools.map(t=>t.name),['list_kids','list_spelling_lists','get_spelling_list','add_spelling_list','update_spelling_list','add_verse','get_shared_list','import_shared_list','get_progress']);
 for(const tool of tools)assert.equal(tool.inputSchema.additionalProperties,false);
});

test('HTTP security: method, origin, authentication, JSON, accept and streamed byte limit',async t=>{
 const {connection,rpc,raw}=await setup(t);const {token}=await connection();
 for(const method of ['GET','DELETE','OPTIONS'])assert.equal((await raw(token,undefined,{method})).status,405);
 assert.equal((await rpc(token,'ping',{}, {headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await rpc(token,'ping',{}, {headers:{Origin:'http://family.example'}})).status,403);
 assert.equal((await rpc(token,'ping',{}, {headers:{Origin:'https://family.example'}})).status,200);
 for(const value of ['',token+'x','fp_'+'a'.repeat(64)+'_'+'b'.repeat(64)])assert.equal((await rpc(value,'ping')).status,401);
 assert.equal((await rpc(token,'ping',{}, {headers:{'Content-Type':'text/plain'}})).status,415);
 assert.equal((await rpc(token,'ping',{}, {headers:{Accept:'text/event-stream'}})).status,406);
 assert.equal((await raw(token,' '.repeat(256*1024+1))).status,413);
 assert.equal((await raw(token,'é'.repeat(140000))).status,413);
 const r=await rpc(token,'ping');assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
});

test('tools reuse list/verse validation, preserve history and return progress without raw answers',async t=>{
 const {f,connection,call}=await setup(t);const {token}=await connection();
 assert.deepEqual(result(await call(token,'list_kids')).kids.map(k=>k.name),['Alex','Sam']);
 const initial=result(await call(token,'list_spelling_lists',{kid:1})).lists;assert.equal(initial.length,1);assert.ok(!initial[0].words);
 const added=result(await call(token,'add_spelling_list',{kid:1,title:'Week two',date:'2026-11-14',words:[{word:'kind',sentence:'Be kind.'}]})).list;
 assert.equal(added.words[0].sentence,'Be kind.');
 const session=(await f.req('/api/sessions',{kid_id:1,list_id:added.id,kind:'spelling'})).body;
 await f.req('/api/attempts',{session_id:session.id,word_id:added.words[0].id,typed:'kind'});await f.req('/api/sessions/complete',{session_id:session.id});
 const updated=result(await call(token,'update_spelling_list',{list_id:added.id,title:'Updated',words:[{word:'light'}]})).list;
 assert.equal(updated.words[0].word,'light');assert.notEqual(updated.words[0].id,added.words[0].id);
 assert.equal(result(await call(token,'get_spelling_list',{list_id:added.id})).list.title,'Updated');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM attempts WHERE word_id=?').get(added.words[0].id).n,1);
 const v=result(await call(token,'add_verse',{kid:1,reference:'John 11:35',text:'Jesus wept.',translation:'KJV'}));assert.ok(v.id);
 const p=result(await call(token,'get_progress',{kid:1}));assert.equal(p.listsCompleted,1);for(const key of ['attempts','learnAttempts','verseAttempts'])assert.equal(p[key],undefined);
 for(const [name,args] of [['add_spelling_list',{kid:1,title:'x',words:[]}],['add_spelling_list',{kid:1,title:'x',words:[{word:'one',unexpected:'x'}]}],['add_spelling_list',{kid:1,title:'x',words:[{word:'one'}],id:1}],['add_verse',{kid:1,reference:'x',text:'a'.repeat(2001)}],['add_verse',{kid:1,reference:'x',text:'text',due_date:'2026-02-30'}],['list_kids',{extra:true}],['get_progress',{kid:''}],['delete_family',{}]])assert.equal((await call(token,name,args)).body.error.code,-32602);
 assert.equal((await call(token,'update_spelling_list',{list_id:added.id,kid:2,title:'No',words:[{word:'bad'}]})).body.error.code,-32602);
 assert.equal((await call(token,'get_progress',{kid:999})).body.result.isError,true);
 await f.req('/api/admin/archive',{type:'lists',id:added.id});assert.equal(result(await call(token,'get_spelling_list',{list_id:added.id})).list.archived,1);
});

test('read-only scope hides writes and cannot execute them',async t=>{
 const {connection,rpc,call}=await setup(t);const {token}=await connection('read-only');
 assert.deepEqual((await rpc(token,'tools/list')).body.result.tools.map(t=>t.name),['list_kids','list_spelling_lists','get_spelling_list','get_shared_list','get_progress']);
 const denied=await call(token,'add_verse',{kid:1,reference:'John 11:35',text:'Jesus wept.'});assert.equal(denied.body.result.isError,true);
 assert.equal(result(await call(token,'list_spelling_lists',{kid:1})).lists.length,1);
});

test('tokens alone route to their family; headers, cookies and changed embedded routing cannot cross families',async t=>{
 const {f,connection,call,rpc}=await setup(t);const a=await connection();const codeA=f.getCode(),cookieA=f.getCookie();
 await f.req('/api/families',{name:'Other',pin:'1234'});await f.req('/api/admin/kids',{name:'Casey'});const b=await connection();
 assert.deepEqual(result(await call(a.token,'list_kids')).kids.map(k=>k.name),['Alex','Sam']);assert.deepEqual(result(await call(b.token,'list_kids')).kids.map(k=>k.name),['Casey']);
 const altered=a.token.replace(a.token.split('_')[1],b.token.split('_')[1]);assert.equal((await call(altered,'list_kids')).status,401);
 const r=await rpc(a.token,'tools/call',{name:'list_kids',arguments:{}},{headers:{'X-Family-Code':f.getCode(),'X-Internal-Family-Hash':b.token.split('_')[1],Cookie:f.getCookie()}});assert.deepEqual(result(r).kids.map(k=>k.name),['Alex','Sam']);
 assert.equal((await f.req('/api/admin/connections/revoke',{id:a.connection.id})).status,404);
 f.setCode(codeA);f.setCookie(cookieA);await f.req('/api/admin/delete-family',{pin:'5678',confirmation:'Practice'});assert.equal((await call(a.token,'list_kids')).status,401);assert.equal((await call(b.token,'list_kids')).status,200);
});

test('durable per-token minute limits and per-family write limits expire and are shared across connections',async t=>{
 const {f,connection,rpc,call}=await setup(t);const a=await connection(),b=await connection();
 for(let i=0;i<60;i++)assert.equal((await rpc(a.token,'ping')).status,200);
 const entry=[...f.databases].find(([key])=>key.startsWith('fam:'))[1];entry.object=new FamilyDatabase(entry.object.ctx,f.env);
 assert.equal((await rpc(a.token,'ping')).status,429);assert.equal((await rpc(b.token,'ping')).status,200);
 f.db.prepare('UPDATE mcp_limits SET until=0').run();assert.equal((await rpc(a.token,'ping')).status,200);
 for(let i=0;i<20;i++)result(await call((i%2?a:b).token,'add_verse',{kid:1,reference:'John 11:35',text:'Jesus wept.'}));
 assert.equal((await call(a.token,'add_verse',{kid:1,reference:'x',text:'text'})).status,429);
 assert.equal((await call(b.token,'add_verse',{kid:1,reference:'x',text:'text'})).status,429);
 assert.equal((await call(a.token,'list_kids')).status,200);
 await f.req('/api/admin/connections/revoke-all',{});const c=await connection();assert.equal((await call(c.token,'add_verse',{kid:1,reference:'x',text:'text'})).status,429);
 f.db.prepare('UPDATE mcp_limits SET until=0').run();assert.equal((await call(c.token,'add_verse',{kid:1,reference:'x',text:'text'})).status,200);
});

test('PIN rotation preserves independently managed connections; backup restore cannot create tokens',async t=>{
 const {f,connection,call}=await setup(t);const a=await connection();const backup=(await f.req('/api/admin/export')).body;
 backup.mcp_connections=[{token:'attacker'}];assert.equal((await f.req('/api/admin/import',backup)).status,200);
 assert.equal((await f.req('/api/admin/connections')).body.connections.length,1);
 assert.equal((await f.req('/api/admin/pin',{currentPin:'5678',pin:'9876'})).status,200);
 assert.equal((await call(a.token,'list_kids')).status,200);assert.equal((await f.req('/api/admin/connections')).body.connections.length,1);
});


test('connection URLs work without headers and reject conflicting bearer identities',async t=>{
 const {f,connection}=await setup(t);const a=await connection(),b=await connection();
 const request=async (path,headers={})=>worker.fetch(new Request('https://family.example'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_kids',arguments:{}}})}),f.env);
 const response=await request('/mcp/t/'+a.token);assert.equal(response.status,200);assert.equal(JSON.parse((await response.json()).result.content[0].text).kids[0].name,'Alex');
 assert.equal((await request('/mcp/t/'+a.token,{Authorization:'Bearer '+b.token})).status,401);
 assert.equal((await request('/mcp/t/'+a.token,{Authorization:'Bearer '+a.token})).status,200);
 for(const path of ['/mcp/t/bad','/mcp/t/'+a.token+'/extra','/mcp/t/'])assert.equal((await request(path)).status,401);
});


test('MCP writes retain existing family content caps and archived-kid protections',async t=>{
 const {f,connection,call}=await setup(t);const {token}=await connection();
 f.db.prepare("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<198) INSERT INTO lists(kid_id,title,date) SELECT 1,'Bounded','2026-11-14' FROM n").run();
 const lists=await call(token,'add_spelling_list',{kid:1,title:'Too many',words:[{word:'no'}]});assert.equal(lists.body.result.isError,true);assert.match(lists.body.result.content[0].text,/200/);
 f.db.prepare("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<298) INSERT INTO verses(kid_id,reference,text) SELECT 1,'John 11:35','Jesus wept.' FROM n").run();
 const verses=await call(token,'add_verse',{kid:1,reference:'John 11:35',text:'Jesus wept.'});assert.equal(verses.body.result.isError,true);assert.match(verses.body.result.content[0].text,/300/);
 f.db.prepare('UPDATE kids SET archived=1 WHERE id=1').run();
 assert.deepEqual(result(await call(token,'list_kids')).kids.map(k=>k.name),['Sam']);
 for(const [name,args] of [['list_spelling_lists',{kid:1}],['get_spelling_list',{list_id:1}],['get_progress',{kid:1}],['add_verse',{kid:1,reference:'John 11:35',text:'Jesus wept.'}]])assert.equal((await call(token,name,args)).body.result.isError,true);
});


test('MCP accepts kid names, optional list fields and archived list metadata; progress is aggregates only',async t=>{
 const {f,connection,call}=await setup(t);const {token}=await connection();
 assert.equal(result(await call(token,'list_spelling_lists',{kid:'aLeX'})).lists[0].word_count,2);
 const added=result(await call(token,'add_spelling_list',{kid:'Alex',words:[{word:'garden'}]})).list;
 assert.equal(added.words[0].sentence,'');assert.ok(added.title);assert.match(added.date,/^\d{4}-\d{2}-\d{2}$/);
 const update=result(await call(token,'update_spelling_list',{list_id:added.id,title:'Title only'})).list;
 assert.equal(update.words[0].word,'garden');assert.equal(update.date,added.date);
 const changed=result(await call(token,'update_spelling_list',{list_id:added.id,words:[{word:'quiet'}]})).list;assert.equal(changed.title,'Title only');
 await f.req('/api/admin/archive',{type:'lists',id:added.id});
 assert.equal(result(await call(token,'list_spelling_lists',{kid:'Alex'})).lists.find(l=>l.id===added.id).archived,true);
 assert.equal(result(await call(token,'get_spelling_list',{list_id:added.id})).list.words[0].word,'quiet');
 const p=result(await call(token,'get_progress',{kid:'ALEX'}));
 assert.deepEqual(Object.keys(p.wordBank).sort(),['counts','dueCount','struggling']);assert.equal(p.sessions,undefined);assert.ok(Array.isArray(p.mastery));
 await f.req('/api/admin/kids',{name:'Alex'});assert.equal((await call(token,'get_progress',{kid:'Alex'})).body.result.isError,true);
 assert.equal((await call(token,'get_progress',{kid:1})).status,200);
});


test('pre-authentication limits bound unknown-token DO dispatch by IP and globally',async t=>{
 const {f,raw}=await setup(t);
 const registry=f.databases.get('registry').db;
 const ip=await sha256(f.env.IP_HASH_SALT+':local');
 registry.prepare('INSERT INTO limits VALUES(?,?,?)').run('mcp:ip:'+ip,240,Date.now()+60000);
 const before=f.databases.size;
 assert.equal((await raw('fp_'+'a'.repeat(64)+'_'+'b'.repeat(64),{jsonrpc:'2.0',id:1,method:'ping'})).status,429);
 assert.equal(f.databases.size,before);
 registry.prepare('DELETE FROM limits').run();registry.prepare('INSERT INTO limits VALUES(?,?,?)').run('mcp:global',2400,Date.now()+60000);
 assert.equal((await raw('fp_'+'c'.repeat(64)+'_'+'d'.repeat(64),{jsonrpc:'2.0',id:1,method:'ping'})).status,429);
 assert.equal(f.databases.size,before);
 registry.prepare('UPDATE limits SET until=0').run();assert.equal((await raw('bad',{jsonrpc:'2.0',id:1,method:'ping'})).status,401);
});
