import {defaults} from './settings.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker,{FamilyDatabase,RegistryLimits} from './worker.js';
import {AccountStore,routeAuth,hmac,signedValue,readValue,normalizeEmail,familyRef,parentRef} from './accounts.js';
import {sha256,generateFamilyCode} from './auth.js';

// Real SQLite and real DO handlers; only the platform namespace/cursor is adapted.
function fixture(t) {
  const databases=new Map(), env={SESSION_SECRET:'identity-test-secret-at-least-32-characters',IP_HASH_SALT:'identity-test-ip-salt-at-least-32-characters',SIGNIN_EMAIL:'1',SIGNIN_GOOGLE:'1'};
  function namespace(Class) {return {idFromName:n=>n,get(n){const key=Class.name+':'+n;if(!databases.has(key)){
    const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');t.after(()=>db.close());
    const sql={exec(q,...args){if(!args.length&&q.includes(';')){db.exec(q);return [];}const s=db.prepare(q);if(s.columns().length)return s.all(...args);s.run(...args);return [];}};
    const ctx={storage:{sql,transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}},blockConcurrencyWhile:fn=>fn()};
    databases.set(key,{db,object:new Class(ctx,env)});
  }return databases.get(key).object;}};}
  env.ACCOUNTS=namespace(AccountStore);env.FAMILY=namespace(FamilyDatabase);env.REGISTRY=namespace(RegistryLimits);
  const jar=new Map();let familyCode='';
  async function req(path,data,extra={},fetchImpl) {
    const request=new Request('http://localhost'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'X-Family-Code':familyCode,...extra},body:data===undefined?undefined:JSON.stringify(data)});
    const r=fetchImpl?await routeAuth(request,env,fetchImpl):await worker.fetch(request,env);
    for(const c of r.headers.getSetCookie()){assert.doesNotMatch(c,/Domain\s*=/i,'every app cookie must be host-only');const pair=c.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
    const text=await r.text();return {status:r.status,headers:r.headers,body:r.headers.get('Content-Type')?.includes('json')?JSON.parse(text):text};
  }
  async function store(path,data={}){const r=await env.ACCOUNTS.get('accounts').fetch(new Request('https://internal'+path,{method:'POST',body:JSON.stringify(data)}));return {status:r.status,body:await r.json()};}
  const users=new Map(),codes=new Map(),calls=[];
  const subFor=email=>'jl1_'+Buffer.from(email).toString('base64url');
  const service={
    async startEmail(input){calls.push(['startEmail',input]);codes.set(input.email,'012345');return {ok:true};},
    async verifyEmail(input){calls.push(['verifyEmail',input]);if(codes.get(input.email)!==input.code)return {error:'invalid_code'};codes.delete(input.email);const sub=subFor(input.email);users.set(sub,{sub,email:input.email});return {sub,email:input.email,isNew:true,ssoTicket:'private-ticket'};},
    async exchangeCode(input){calls.push(['exchangeCode',input]);return {sub:'jl1_oauthsub',email:'google@example.com'};},
    async getUser(input){calls.push(['getUser',input]);return users.get(typeof input==='string'?input:input.sub)||null;},
    async deleteLink(input){calls.push(['deleteLink',input]);return {deleted:'link'};}
  };
  env.ACCOUNTS_SVC=service;
  async function login(email='parent@example.com',family){
    assert.equal((await req('/api/auth/code/send',{email,...(family?{familyCode:family}:{})})).status,200);
    const code=codes.get(email),result=await req('/api/auth/code/verify',{email,code});
    assert.equal(result.status,200,JSON.stringify(result.body));return {email,code,hash:subFor(email)};
  }
  async function create(name='Test family'){const r=await req('/api/families',{name,pin:'1234'});assert.equal(r.status,201,JSON.stringify(r.body));familyCode=r.body.code;return familyCode;}
  return {env,req,store,login,create,jar,databases,service,users,codes,calls,subFor,setFamily:code=>{familyCode=code;},get db(){env.ACCOUNTS.get('accounts');return databases.get('AccountStore:accounts').db;}};
}

test('email normalization and purpose-bound expiring signed values',async()=>{
  assert.equal(normalizeEmail(' Parent@Example.COM '),'parent@example.com');for(const v of ['',null,'a@b','a b@example.com'])assert.throws(()=>normalizeEmail(v));

  const secret='test',token=await signedValue(secret,'session',{exp:2000,hash:'a'});
  assert.equal((await readValue(secret,'session',token,1999)).hash,'a');
  for(const [s,k,v,n]of [[secret,'session',token,2000],[secret,'oauth',token,1],['wrong','session',token,1],[secret,'session',token+'x',1],[secret,'session',token+'.extra',1]])assert.equal(await readValue(s,k,v,n),null);
});

test('cross-family recovery, account parent access and unlink isolation',async t=>{
  const f=fixture(t),a=await f.create('A');await f.login('parent@example.com',a);
  const b=await f.create('B');f.jar.delete('parent');
  assert.equal((await f.req('/api/admin/export')).status,200);
  const recovered=(await f.req('/api/auth/recover')).body.families;assert.equal(recovered.length,2);
  const ah=await familyRef(f.env,await sha256(a)),bh=await familyRef(f.env,await sha256(b));assert.equal((await f.req('/api/auth/open',{hash:ah})).body.code,a);
  assert.equal((await f.req('/api/auth/open',{hash:'unlinked'})).status,403);
  const hash=f.subFor('parent@example.com');await f.req('/api/auth/unlink',{familyCode:b,parentHash:await parentRef(f.env,hash)});
  assert.equal((await f.req('/api/admin/export')).status,401);
  assert.deepEqual((await f.req('/api/auth/recover')).body.families.map(x=>x.hash),[ah]);assert.notEqual(ah,bh);
  f.setFamily(a);assert.equal((await f.req('/api/admin/export')).status,200);
});

test('linking requires existing unlocked family; fifth parent and sixth family rejected',async t=>{
  const f=fixture(t),code=await f.create();await f.req('/api/parent/lock',{});await f.login();
  assert.equal((await f.req('/api/auth/link',{familyCode:generateFamilyCode()})).status,404);
  assert.equal((await f.req('/api/auth/link',{familyCode:code})).status,401);
  await f.req('/api/parent/unlock',{pin:'1234'});assert.equal((await f.req('/api/auth/link',{familyCode:code})).status,200);
  const hash=f.subFor('parent@example.com');
  for(let i=1;i<5;i++)assert.equal((await f.store('/link',{hash,family:{hash:'extra'+i,name:'Extra',code:'x'}})).status,200);
  assert.equal((await f.store('/link',{hash,family:{hash:'sixth'}})).status,409);
  assert.equal((await f.store('/link',{hash,family:{hash:'extra1',name:'Updated'}})).status,200);
  for(let i=1;i<4;i++){f.jar.delete('fp_account');await f.login('parent'+i+'@example.com',code);}
  f.jar.delete('fp_account');await f.login('fifth@example.com');assert.equal((await f.req('/api/auth/link',{familyCode:code})).status,409);
  assert.equal((await f.req('/api/auth/recover')).body.families.length,0);
});

test('session tampering/expiry/epoch/deletion and unsubscribe purpose validation',async t=>{
  const f=fixture(t),{hash}=await f.login(),token=f.jar.get('fp_account');
  f.jar.set('fp_account',token+'x');assert.equal((await f.req('/api/auth/session')).body.signedIn,false);
  const account=(await f.store('/get',{hash})).body.account;
  for(const data of [{hash,epoch:account.epoch,exp:Date.now()-1},{hash,epoch:'old',exp:Date.now()+10000}]){f.jar.set('fp_account',await signedValue(f.env.SESSION_SECRET,'session',data));assert.equal((await f.req('/api/auth/session')).body.signedIn,false);}
  f.jar.set('fp_account',token);assert.equal((await f.req('/api/auth/prefs',{weekly:true,classUpdates:true,review:true,timezone:'UTC'})).status,200);
  assert.equal((await f.req('/api/auth/prefs',{timezone:'not-a-timezone'})).status,400);
  const u=await signedValue(f.env.SESSION_SECRET,'unsubscribe',{hash,exp:Date.now()+10000});
  assert.equal((await f.req('/auth/unsubscribe?token='+encodeURIComponent(token))).status,401);
  assert.equal((await f.req('/auth/unsubscribe?token='+encodeURIComponent(u))).status,200);
  assert.deepEqual((await f.req('/api/auth/session')).body.prefs,{weekly:false,classUpdates:false,review:false,timezone:'UTC'});
  assert.equal((await f.req('/auth/unsubscribe?token='+encodeURIComponent(u),{})).status,200);
  assert.equal((await f.req('/api/auth/delete',{})).status,200);f.jar.set('fp_account',token);
  assert.equal((await f.req('/api/auth/session')).body.signedIn,false);
  await f.login();f.jar.set('fp_account',token);assert.equal((await f.req('/api/auth/session')).body.signedIn,false);
});

test('auth-family lookups share durable unknown-code throttles',async t=>{
 const f=fixture(t);for(let i=0;i<30;i++)assert.equal((await f.req('/api/auth/parents',undefined,{'X-Family-Code':generateFamilyCode()})).status,404);
 assert.equal((await f.req('/api/auth/parents',undefined,{'X-Family-Code':generateFamilyCode()})).status,429);
});
test('mail claims recheck opt-in and current links after a stale cron read',async t=>{
 const f=fixture(t),code=await f.create(),{hash}=await f.login('parent@example.com',code),family=await sha256(code);
 const claim={hash,key:'weekly',value:'2026-11-15',familyHashes:[family]};
 assert.equal((await f.store('/claim',claim)).body.claimed,false);
 await f.req('/api/auth/prefs',{weekly:true,timezone:'UTC'});
 assert.equal((await f.store('/claim',{...claim,familyHashes:['removed']})).body.claimed,false);
 assert.equal((await f.store('/claim',claim)).body.claimed,true);
 assert.equal((await f.store('/claim',claim)).body.claimed,false);
 await f.store('/unsubscribe',{hash});assert.equal((await f.store('/claim',{...claim,value:'2026-11-22'})).body.claimed,false);
});

test('family deletion removes identity links and still requires the fresh PIN',async t=>{
 const f=fixture(t),a=await f.create('A');await f.login('parent@example.com',a);await f.create('B');
 assert.equal((await f.req('/api/admin/delete-family',{pin:'0000',confirmation:'B'})).status,401);
 assert.equal((await f.req('/api/admin/delete-family',{pin:'1234',confirmation:'B'})).status,200);
 const families=(await f.req('/api/auth/recover')).body.families;assert.deepEqual(families.map(x=>x.code),[a]);
});

test('family identifiers never leave public responses, decoded cookies or account references as bare SHA256',async t=>{
 const f=fixture(t),code=await f.create(),hash=await sha256(code);
 const inspect=r=>{
  const wire=JSON.stringify({body:r.body,headers:[...r.headers]});
  assert.ok(!wire.includes(hash),wire);
  for(const c of r.headers.getSetCookie()){
   const value=c.split(';')[0].split('=').slice(1).join('=');
   const payload=value.split('.')[0];
   try{assert.ok(!atob(payload.replaceAll('-','+').replaceAll('_','/')).includes(hash));}catch(e){if(e.code==='ERR_ASSERTION')throw e;}
  }
  return r;
 };
 inspect(await f.req('/api/parent/unlock',{pin:'1234'}));
 await f.login('privacy@example.com',code);
 for(const path of ['/api/auth/session','/api/auth/recover','/api/state','/api/admin/export','/api/admin/connections','/api/auth/parents'])inspect(await f.req(path));
 const session=inspect(await f.req('/api/auth/session')),ref=session.body.families[0].hash;
 assert.notEqual(ref,hash);assert.equal(ref,await familyRef(f.env,hash));
 assert.equal((await f.req('/api/auth/open',{hash})).status,403);
 inspect(await f.req('/api/auth/open',{hash:ref}));
 inspect(await f.req('/api/admin/connections',{name:'Private link',scope:'read-only'}));
 inspect(await f.req('/auth/jesklabs/start?mode=google&familyCode='+code));
});

function privateCookies(response){
 for(const cookie of response.headers.getSetCookie()){
  assert.match(cookie,/; Path=\//);assert.match(cookie,/; HttpOnly/);assert.match(cookie,/; Secure/);assert.match(cookie,/; SameSite=Lax/);assert.doesNotMatch(cookie,/; Domain=/i);
 }
}
async function oauth(f,mode='google',familyCode){
 const start=await f.req('/api/auth/start',{mode,...(familyCode?{familyCode}:{})});
 assert.equal(start.status,200,JSON.stringify(start.body));
 const target=new URL(start.body.url),flow=await readValue(f.env.SESSION_SECRET,'oauth',f.jar.get('__Host-jl_auth'));
 assert.ok(flow);assert.equal(flow.mode,mode);privateCookies(start);
 return {start,target,flow,callback:'/auth/jesklabs/callback?code=spelling-code&state='+flow.state};
}

test('feature flags require service binding; JSON, size and origin boundaries remain enforced',async t=>{
 const f=fixture(t);
 assert.deepEqual((await f.req('/api/auth/config')).body,{email:true,google:true,sso:true});
 f.env.SIGNIN_GOOGLE='0';assert.deepEqual((await f.req('/api/auth/config')).body,{email:true,google:false,sso:true});
 assert.equal((await f.req('/api/auth/start',{mode:'google'})).status,404);
 assert.equal((await f.req('/auth/jesklabs/start?mode=google')).status,404);
 f.env.SIGNIN_EMAIL='0';f.env.SIGNIN_GOOGLE='0';
 assert.deepEqual((await f.req('/api/auth/config')).body,{email:false,google:false,sso:false});
 for(const path of ['/api/auth/code/send','/api/auth/code/verify'])assert.equal((await f.req(path,{email:'p@example.com',code:'012345'})).status,404);
 assert.equal((await f.req('/api/auth/start',{mode:'google'})).status,404);
 assert.equal((await f.req('/auth/jesklabs/start?mode=google')).status,404);
 delete f.env.ACCOUNTS_SVC;f.env.SIGNIN_EMAIL='1';f.env.SIGNIN_GOOGLE='1';
 assert.equal((await f.req('/api/auth/code/send',{email:'p@example.com'})).status,404);
 assert.equal((await f.req('/api/auth/code/verify',{email:'p@example.com',code:'012345'})).status,404);
 assert.deepEqual((await f.req('/api/auth/config')).body,{email:false,google:false,sso:false});
 assert.equal((await f.req('/api/auth/start',{mode:'sso'})).status,404);
 f.env.ACCOUNTS_SVC=f.service;f.env.SIGNIN_EMAIL='1';
 assert.equal((await f.req('/api/auth/code/send',{email:'p@example.com'},{Origin:'https://evil.example'})).status,403);
 assert.equal((await f.req('/api/auth/code/send',{email:'p@example.com'},{'Content-Type':'text/plain'})).status,415);
 assert.equal((await f.req('/api/auth/code/send',{email:'x'.repeat(4100)})).status,413);
 assert.equal((await f.req('/api/auth/start',{mode:'other'})).status,404);
});

test('email RPC uses pairwise sub, private session, one-use SpellingClient codes and attach URL without logging ticket',async t=>{
 const f=fixture(t),email='parent@example.com';
 const logs=[];for(const method of ['log','info','warn','error','debug'])t.mock.method(console,method,(...args)=>logs.push(args));
 assert.equal((await f.req('/api/auth/code/send',{email:' Parent@Example.COM '})).status,200);
 const sent=f.calls.find(([method])=>method==='startEmail')[1];assert.equal(sent.email,email);assert.equal(typeof sent.ip,'string');assert.ok(!('client' in sent));
 // This fake is the SpellingClient binding: a different application's code has no authority here.
 assert.equal((await f.req('/api/auth/code/verify',{email,code:'654321'})).status,401);
 const response=await f.req('/api/auth/code/verify',{email,code:'012345'});assert.equal(response.status,200);
 assert.equal(response.body.ok,true);const attach=new URL(response.body.attachUrl);assert.equal(attach.searchParams.get('ticket'),'private-ticket');
 assert.deepEqual(Object.keys(response.body).sort(),['attachUrl','ok']);privateCookies(response);
 assert.equal(response.headers.get('Cache-Control'),'no-store');assert.match(response.headers.get('Set-Cookie'),/fp_account=.*Max-Age=2592000/);
 const stored=(await f.store('/get',{hash:f.subFor(email)})).body.account;assert.equal(stored.hash,f.subFor(email));assert.equal(stored.email,email);
 assert.equal((await f.store('/get',{hash:await sha256(email)})).body.account,null);
 const session=(await f.req('/api/auth/session')).body;assert.equal(session.signedIn,true);assert.equal(session.email,'p•••@example.com');assert.equal(session.hash,undefined);
 assert.equal((await f.req('/api/auth/code/verify',{email,code:'012345'})).status,401);
 assert.ok(!JSON.stringify(logs).includes('private-ticket'));
 assert.equal((await f.req('/api/auth/signout',{})).status,200);assert.equal((await f.req('/api/auth/session')).body.signedIn,false);
});

for(const [method,path,input,errors] of [
 ['startEmail','/api/auth/code/send',{email:'p@example.com'},[['invalid_email',400],['rate_limited',429],['temporarily_unavailable',503],['invalid_client',503],['invalid_identity',401],['invalid_grant',401],['unexpected_error',503]]],
 ['verifyEmail','/api/auth/code/verify',{email:'p@example.com',code:'012345'},[['invalid_code',401],['expired',401],['rate_limited',429],['temporarily_unavailable',503],['invalid_client',503],['invalid_identity',401],['invalid_grant',401],['unexpected_error',503]]]
])test(`${method} maps all RPC error values and thrown failures`,async t=>{
 const f=fixture(t);
 for(const [error,status] of errors){f.service[method]=async()=>({error,retryAfter:60});const r=await f.req(path,input);assert.equal(r.status,status,JSON.stringify({error,body:r.body}));assert.equal((await f.req('/api/auth/session')).body.signedIn,false);}
 f.service[method]=async()=>{throw Error('private provider detail');};const r=await f.req(path,input);assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r.body),/private provider detail/);
});

test('Google/SSO start uses PKCE, signed host-only flow and callback exchange; state mismatch is friendly',async t=>{
 const f=fixture(t),{target,flow}=await oauth(f);
 assert.equal(target.searchParams.get('client_id')||target.searchParams.get('client'),'spelling');
 assert.equal(target.searchParams.get('state'),flow.state);assert.equal(target.searchParams.get('code_challenge_method'),'S256');
 assert.equal(target.searchParams.get('code_challenge'),Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(flow.verifier))).toString('base64url'));
 assert.equal(flow.redirectUri,'http://localhost/auth/jesklabs/callback');
 const bad=await f.req('/auth/jesklabs/callback?code=spelling-code&state=wrong');assert.equal(bad.status,302);assert.equal(bad.headers.get('Location'),'/?auth=error');assert.equal(f.calls.filter(([m])=>m==='exchangeCode').length,0);assert.equal(f.jar.get('__Host-jl_auth'),'');
 // A state failure consumes the browser flow; initiate again for success.
 const next=await oauth(f);const result=await f.req(next.callback);assert.equal(result.status,302);assert.equal(result.headers.get('Location'),'/?signedIn=1');privateCookies(result);
 const exchange=f.calls.find(([m])=>m==='exchangeCode')[1];assert.deepEqual(exchange,{code:'spelling-code',codeVerifier:next.flow.verifier,redirectUri:next.flow.redirectUri});
 assert.equal(f.jar.get('__Host-jl_auth'),'');assert.equal((await f.req('/api/auth/session')).body.signedIn,true);
 const getStart=await f.req('/auth/jesklabs/start?mode=sso');assert.equal(getStart.status,302);privateCookies(getStart);
});

test('SSO pending confirmation has no session, requires Origin, and decline clears pending',async t=>{
 const f=fixture(t);f.users.set('jl1_oauthsub',{sub:'jl1_oauthsub',email:'google@example.com'});
 let flow=await oauth(f,'sso'),result=await f.req(flow.callback);assert.equal(result.status,302);assert.equal(result.headers.get('Location'),'/?auth=confirm');privateCookies(result);
 assert.equal((await f.req('/api/auth/session')).body.signedIn,false);assert.deepEqual((await f.req('/api/auth/pending')).body,{email:'g•••@example.com'});
 assert.equal((await f.req('/api/auth/confirm',{})).status,403);
 assert.equal((await f.req('/api/auth/confirm',{},{Origin:'https://evil.example'})).status,403);
 result=await f.req('/api/auth/confirm',{},{Origin:'http://localhost'});assert.equal(result.status,200,JSON.stringify(result.body));privateCookies(result);assert.equal((await f.req('/api/auth/session')).body.signedIn,true);assert.equal(f.jar.get('__Host-jl_pending'),'');
 await f.req('/api/auth/signout',{});flow=await oauth(f,'sso');await f.req(flow.callback);
 const decline=await f.req('/api/auth/decline',{});assert.equal(decline.status,200);privateCookies(decline);assert.equal(f.jar.get('__Host-jl_pending'),'');assert.deepEqual((await f.req('/api/auth/pending')).body,{email:null});assert.equal((await f.req('/api/auth/session')).body.signedIn,false);
});

test('callback RPC failures are friendly redirects and never establish sessions',async t=>{
 const f=fixture(t);
 for(const value of [{error:'invalid_grant'},{error:'temporarily_unavailable'},{error:'invalid_client'},null]){
  const flow=await oauth(f);f.service.exchangeCode=async()=>value;
  const r=await f.req(flow.callback);assert.equal(r.status,302);assert.equal(r.headers.get('Location'),'/?auth=error');assert.equal((await f.req('/api/auth/session')).body.signedIn,false);
 }
 const flow=await oauth(f);f.service.exchangeCode=async()=>{throw Error('private exchange failure');};const r=await f.req(flow.callback);assert.equal(r.status,302);assert.equal(r.headers.get('Location'),'/?auth=error');assert.doesNotMatch(r.body,/private exchange failure/);
});

test('public parent references are purpose-bound HMACs; raw RPC sub cannot unlink',async t=>{
 const f=fixture(t),code=await f.create(),{hash}=await f.login('privacy@example.com',code),ref=await parentRef(f.env,hash);
 assert.equal(ref,await hmac(f.env.SESSION_SECRET,'account-parent:'+hash));assert.notEqual(ref,await familyRef(f.env,hash));
 const list=await f.req('/api/auth/parents');assert.equal(list.status,200);assert.equal(list.body.parents[0].hash,ref);assert.ok(!JSON.stringify(list.body).includes(hash));
 assert.equal((await f.req('/api/auth/unlink',{familyCode:code,parentHash:hash})).status,404);
 assert.equal((await f.req('/api/auth/unlink',{familyCode:code,parentHash:ref})).status,200);assert.equal((await f.req('/api/auth/parents')).body.parents.length,0);
});

test('email pending link is server-side, HMAC-keyed, one use and expires',async t=>{
 const f=fixture(t),code=await f.create(),email='pending@example.com';
 await f.req('/api/auth/code/send',{email,familyCode:code});
 const rows=f.db.prepare('SELECT * FROM pending_links').all();assert.equal(rows.length,1);assert.ok(!JSON.stringify(rows).includes(email));assert.equal(rows[0].key,await hmac(f.env.SESSION_SECRET,'email-link:'+email));
 const response=await f.req('/api/auth/code/verify',{email,code:'012345'});assert.equal(response.status,200,JSON.stringify(response.body));assert.equal((await f.req('/api/auth/recover')).body.families.length,1);assert.equal(f.db.prepare('SELECT * FROM pending_links').all().length,0);
 assert.equal((await f.store('/pending/set',{key:'one-use',family:{code,epoch:'proof'}})).status,200);
 assert.deepEqual((await f.store('/pending/take',{key:'one-use'})).body.family,{code,epoch:'proof'});
 assert.equal((await f.store('/pending/take',{key:'one-use'})).body.family,null);
 await f.store('/pending/set',{key:'expired',family:{code,epoch:'proof'}});
 // The expiry is persisted, so it survives worker restarts rather than relying on an in-memory timer.
 f.db.prepare('UPDATE pending_links SET until=?').run(Date.now()-1);
 assert.equal((await f.store('/pending/take',{key:'expired'})).body.family,null);
});

test('account deletion unlinks service identity and local families; thrown RPC errors are 503',async t=>{
 const f=fixture(t),code=await f.create(),{hash}=await f.login('delete@example.com',code);
 f.service.deleteLink=async()=>{throw Error('private deletion detail');};let r=await f.req('/api/auth/delete',{});assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r.body),/private deletion detail/);
 f.service.deleteLink=async input=>{f.calls.push(['deleteLink',input]);return {deleted:'link'};};r=await f.req('/api/auth/delete',{});assert.equal(r.status,200);assert.deepEqual(f.calls.find(([m])=>m==='deleteLink')[1],{sub:hash});assert.equal((await f.store('/get',{hash})).body.account,null);assert.equal((await f.req('/api/auth/session')).body.signedIn,false);assert.equal((await f.req('/api/auth/parents')).body.parents.length,0);
});

test('null email uses getUser fallback; null user still supports a Google-only account',async t=>{
 const f=fixture(t);f.service.exchangeCode=async()=>({sub:'jl1_emailfallback',email:null,isNew:false});
 f.service.getUser=async input=>{assert.deepEqual(input,{sub:'jl1_emailfallback'});return {sub:input.sub,email:'fallback@example.com',hasGoogle:true,clients:['spelling']};};
 let flow=await oauth(f,'sso');await f.req(flow.callback);assert.deepEqual((await f.req('/api/auth/pending')).body,{email:'f•••@example.com'});
 await f.req('/api/auth/decline',{});
 f.service.getUser=async()=>null;flow=await oauth(f,'sso');await f.req(flow.callback);assert.deepEqual((await f.req('/api/auth/pending')).body,{email:'Google account'});assert.equal((await f.req('/api/auth/session')).body.signedIn,false);
 assert.equal((await f.req('/api/auth/confirm',{},{Origin:'http://localhost'})).status,200);
 assert.equal((await f.req('/api/auth/session')).body.email,'Google account');assert.equal((await f.store('/get',{hash:'jl1_emailfallback'})).body.account.email,null);
});

test('getUser error values and exceptions cannot silently authenticate',async t=>{
 const f=fixture(t);f.service.verifyEmail=async()=>({sub:'jl1_fallback',email:null,ssoTicket:'private-ticket'});
 for(const value of [{error:'temporarily_unavailable'},{error:'invalid_client'},{error:'unexpected_error'}]){
  f.service.getUser=async()=>value;assert.equal((await f.req('/api/auth/code/verify',{email:'p@example.com',code:'012345'})).status,503);assert.equal((await f.req('/api/auth/session')).body.signedIn,false);
 }
 f.service.getUser=async()=>{throw Error('private user detail');};const response=await f.req('/api/auth/code/verify',{email:'p@example.com',code:'012345'});assert.equal(response.status,503);assert.doesNotMatch(JSON.stringify(response.body),/private user detail/);
});

test('email and OAuth pending linking proofs cannot restore a revoked parent; locking signs out',async t=>{
 const f=fixture(t),code=await f.create(),email='parent@example.com',{hash}=await f.login(email,code),ref=await parentRef(f.env,hash);
 await f.req('/api/auth/code/send',{email,familyCode:code});
 assert.equal((await f.req('/api/auth/unlink',{familyCode:code,parentHash:ref})).status,200);f.jar.delete('parent');
 assert.equal((await f.req('/api/auth/code/verify',{email,code:'012345'})).status,403);assert.equal((await f.req('/api/admin/export')).status,401);
 await f.req('/api/parent/unlock',{pin:'1234'});await f.req('/api/auth/link',{familyCode:code});
 const flow=await oauth(f,'sso',code);f.service.exchangeCode=async()=>({sub:hash,email,isNew:false});
 await f.req('/api/auth/unlink',{familyCode:code,parentHash:ref});f.jar.delete('parent');await f.req(flow.callback);
 assert.equal((await f.req('/api/auth/confirm',{},{Origin:'http://localhost'})).status,403);assert.equal((await f.req('/api/admin/export')).status,401);
 await f.req('/api/parent/unlock',{pin:'1234'});await f.req('/api/auth/link',{familyCode:code});f.jar.delete('parent');assert.equal((await f.req('/api/admin/export')).status,200);
 await f.req('/api/parent/lock',{});assert.equal((await f.req('/api/auth/session')).body.signedIn,false);assert.equal((await f.req('/api/admin/export')).status,401);
});

test('expired/tampered auth and pending cookies, missing code and upstream errors redirect safely',async t=>{
 const f=fixture(t);
 for(const kind of ['expired','tampered','missing-code','login_required','access_denied']){
  const {flow}=await oauth(f,'sso');
  let url='/auth/jesklabs/callback?state='+flow.state;
  if(kind==='expired')f.jar.set('__Host-jl_auth',await signedValue(f.env.SESSION_SECRET,'oauth',{...flow,exp:Date.now()-1}));
  if(kind==='tampered')f.jar.set('__Host-jl_auth',f.jar.get('__Host-jl_auth')+'x');
  if(kind==='login_required'||kind==='access_denied')url+='&error='+kind;else if(kind!=='missing-code')url+='&code=spelling-code';
  const response=await f.req(url);assert.equal(response.status,302);assert.equal(response.headers.get('Location'),kind==='login_required'?'/?auth=signin':'/?auth=error');assert.equal(f.jar.get('__Host-jl_auth'),'');
 }
 assert.equal((await f.req('/api/auth/confirm',{},{Origin:'http://localhost'})).status,401);
 const flow=await oauth(f,'sso');await f.req(flow.callback);
 const pending=await readValue(f.env.SESSION_SECRET,'pending',f.jar.get('__Host-jl_pending'));
 f.jar.set('__Host-jl_pending',await signedValue(f.env.SESSION_SECRET,'pending',{...pending,exp:Date.now()-1}));assert.deepEqual((await f.req('/api/auth/pending')).body,{email:null});assert.equal((await f.req('/api/auth/confirm',{},{Origin:'http://localhost'})).status,401);
});

test('deleteLink error values and throws preserve local account and links',async t=>{
 const f=fixture(t),code=await f.create(),{hash}=await f.login('delete-errors@example.com',code);
 for(const error of ['temporarily_unavailable','invalid_client','unexpected_error']){
  f.service.deleteLink=async()=>({error});assert.equal((await f.req('/api/auth/delete',{})).status,503);assert.ok((await f.store('/get',{hash})).body.account);assert.equal((await f.req('/api/auth/parents')).body.parents.length,1);
 }
});

test('optional-mail quotas, class/review claim checks and delivery deduplication remain local',async t=>{
 const f=fixture(t),code=await f.create(),{hash}=await f.login('mail@example.com',code),family=await sha256(code);
 for(const key of ['review','class:list-1','unknown'])assert.equal((await f.store('/claim',{hash,key,value:'first',familyHashes:[family]})).body.claimed,false);
 await f.req('/api/auth/prefs',{classUpdates:true,review:true,weekly:false,timezone:'UTC'});
 for(const key of ['review','class:list-1']){
  assert.equal((await f.store('/claim',{hash,key,value:'first',familyHashes:[family]})).body.claimed,true);
  assert.equal((await f.store('/claim',{hash,key,value:'first',familyHashes:[family]})).body.claimed,false);
 }
 assert.equal((await f.store('/claim',{hash,key:'review',value:'second',familyHashes:['unlinked']})).body.claimed,false);
 for(let i=0;i<defaults.mailDaily;i++)assert.equal((await f.store('/mail-reserve')).status,200);
 assert.equal((await f.store('/mail-reserve')).status,429);await f.store('/mail-failed');
 assert.deepEqual((await f.store('/stats')).body.daily.map(({sent,failed})=>({sent,failed})),[{sent:defaults.mailDaily,failed:1}]);
 f.db.prepare('UPDATE account_limits SET until=?').run(Date.now()-1);assert.equal((await f.store('/mail-reserve')).status,200);
});

test('failed sends preserve browser-bound email linking intent; another browser cannot apply it',async t=>{
 const f=fixture(t),code=await f.create(),email='browser@example.com';await f.req('/api/auth/code/send',{email,familyCode:code});const original=f.jar.get('__Host-jl_email');
 f.service.startEmail=async()=>({error:'rate_limited',retryAfter:30});assert.equal((await f.req('/api/auth/code/send',{email})).status,429);assert.equal(f.jar.get('__Host-jl_email'),original);
 f.jar.delete('__Host-jl_email');assert.equal((await f.req('/api/auth/code/verify',{email,code:'012345'})).status,200);assert.equal((await f.req('/api/auth/recover')).body.families.length,0);
});
test('incomplete email success cannot mutate local links or accounts',async t=>{const f=fixture(t),code=await f.create(),email='incomplete@example.com';await f.req('/api/auth/code/send',{email,familyCode:code});f.service.verifyEmail=async()=>({sub:'jl1_incomplete',email});assert.equal((await f.req('/api/auth/code/verify',{email,code:'012345'})).status,503);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM accounts').get().n,0);assert.equal((await f.req('/api/auth/parents')).body.parents.length,0);});
test('private cookies encrypt subjects and support Unicode email in SSO consent',async t=>{const f=fixture(t),email='親@example.com',sub='jl1_privateunicode';f.service.exchangeCode=async()=>({sub,email});let flow=await oauth(f,'sso');await f.req(flow.callback);assert.deepEqual((await f.req('/api/auth/pending')).body,{email:'親•••@example.com'});for(const name of ['__Host-jl_pending'])assert.ok(!Buffer.from(f.jar.get(name).split('.')[0],'base64url').toString().includes(sub));await f.req('/api/auth/confirm',{},{Origin:'http://localhost'});assert.equal((await f.req('/api/auth/session')).body.signedIn,true);assert.ok(!Buffer.from(f.jar.get('fp_account').split('.')[0],'base64url').toString().includes(sub));});
test('Google callback stays disabled independently of email/SSO gate',async t=>{const f=fixture(t),flow=await oauth(f);f.env.SIGNIN_GOOGLE='0';assert.equal((await f.req(flow.callback)).status,404);assert.equal(f.calls.filter(([method])=>method==='exchangeCode').length,0);});
