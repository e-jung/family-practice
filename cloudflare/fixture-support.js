import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker,{FamilyDatabase,RegistryLimits,TtsCache} from './worker.js';
// Implements the actual DO SQL cursor + transaction interface, not query-specific stubs.
export function emptyFixture(t) {
  const databases=new Map();
  const env={SESSION_SECRET:'test-secret-32-characters-minimum-long',IP_HASH_SALT:'test-ip-salt-32-characters-minimum-long'};
  function storage(name,Class) {
    if(databases.has(name))return databases.get(name).object;
    const db=new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); t.after(()=>db.close());
    const sql={exec(query,...args) {
      if(!args.length && query.includes(';')) {db.exec(query);return [];}
      const stmt=db.prepare(query);if(stmt.columns().length)return stmt.all(...args);stmt.run(...args);return [];
    }};
    const ctx={storage:{sql,transactionSync(fn){db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}},blockConcurrencyWhile:fn=>fn()};
    const object=new Class(ctx,env);databases.set(name,{db,object});return object;
  }
  env.FAMILY={idFromName:name=>name,get:name=>storage(name,FamilyDatabase)};
  env.REGISTRY={idFromName:name=>name,get:name=>storage(name,RegistryLimits)};
  env.TTS_CACHE={idFromName:name=>name,get:name=>storage(name,TtsCache)};
  env.ASSETS={fetch:request=>new Response('static asset',{status:['/','/app.js','/style.css'].includes(new URL(request.url).pathname)?200:404})};
  let cookie='',code='';
  async function req(path,data,extra={}) {
    const response=await worker.fetch(new Request('https://family.example'+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'content-type':'application/json'}),cookie,'X-Family-Code':code,...extra},body:data===undefined?undefined:JSON.stringify(data)}),env);
    if(response.headers.has('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
    const text=await response.text(); const body=response.headers.get('content-type')?.includes('json')?JSON.parse(text):text;
    if(path==='/api/families' && response.ok) code=body.code;
    return {status:response.status,headers:response.headers,body};
  }
  return {req,env,databases,get db(){return [...databases].find(([key])=>key.startsWith('fam:'))?.[1].db;},getCode:()=>code,setCode:v=>{code=v;},getCookie:()=>cookie,setCookie:v=>{cookie=v;}};
}
export async function fixture(t) {
  const f=emptyFixture(t);
  assert.equal((await f.req('/api/families',{name:'Practice',pin:'5678'})).status,201);
  for(const name of ['Alex','Sam']) {
    await f.req('/api/admin/kids',{name});
    await f.req('/api/admin/sample',{kid_id:name==='Alex'?1:2});
  }
  await f.req('/api/parent/lock',{});return f;
}
