import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker,{FamilyDatabase,RegistryLimits} from './worker.js';
import {AccountStore,routeAuth,hmac,signedValue,readValue,normalizeEmail,generateLoginCode} from './accounts.js';
import {sha256,generateFamilyCode} from './auth.js';

// Real SQLite and real DO handlers; only the platform namespace/cursor is adapted.
function fixture(t) {
  const databases=new Map(), env={SESSION_SECRET:'identity-test-secret-at-least-32-characters',IP_HASH_SALT:'identity-test-ip-salt-at-least-32-characters',EMAIL_TEST_SINK:'1'};
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
    for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
    const text=await r.text();return {status:r.status,headers:r.headers,body:r.headers.get('Content-Type')?.includes('json')?JSON.parse(text):text};
  }
  async function store(path,data={}){const r=await env.ACCOUNTS.get('accounts').fetch(new Request('https://internal'+path,{method:'POST',body:JSON.stringify(data)}));return {status:r.status,body:await r.json()};}
  async function login(email='parent@example.com',family){assert.equal((await req('/api/auth/code/send',{email,...(family?{familyCode:family}:{})})).status,200);const message=(await req('/api/auth/test/last-message?email='+encodeURIComponent(email))).body.message;const code=message.text.match(/\b\d{6}\b/)[0];const result=await req('/api/auth/code/verify',{email,code});assert.equal(result.status,200,JSON.stringify(result.body));return {email,code,hash:await sha256(email)};}
  async function create(name='Test family'){const r=await req('/api/families',{name,pin:'1234'});assert.equal(r.status,201,JSON.stringify(r.body));familyCode=r.body.code;return familyCode;}
  return {env,req,store,login,create,jar,databases,setFamily:code=>{familyCode=code;},get db(){env.ACCOUNTS.get('accounts');return databases.get('AccountStore:accounts').db;}};
}

test('email normalization, six digit codes and purpose-bound expiring signed values',async()=>{
  assert.equal(normalizeEmail(' Parent@Example.COM '),'parent@example.com');for(const v of ['',null,'a@b','a b@example.com'])assert.throws(()=>normalizeEmail(v));
  for(let i=0;i<100;i++)assert.match(generateLoginCode(),/^\d{6}$/);
  const secret='test',token=await signedValue(secret,'session',{exp:2000,hash:'a'});
  assert.equal((await readValue(secret,'session',token,1999)).hash,'a');
  for(const [s,k,v,n]of [[secret,'session',token,2000],[secret,'oauth',token,1],['wrong','session',token,1],[secret,'session',token+'x',1],[secret,'session',token+'.extra',1]])assert.equal(await readValue(s,k,v,n),null);
});

test('login stores only HMAC code, one use, private cookies, masked session and signout',async t=>{
  const f=fixture(t),email='parent@example.com',hash=await sha256(email);
  assert.equal((await f.req('/api/auth/code/send',{email:' Parent@Example.com '})).status,200);
  const message=(await f.req('/api/auth/test/last-message?email='+email)).body.message,code=message.text.match(/\b\d{6}\b/)[0];
  const stored=f.db.prepare('SELECT data FROM challenges WHERE hash=?').get(hash).data,c=JSON.parse(stored);
  assert.equal(c.digest,await hmac(f.env.SESSION_SECRET,hash+':'+code));assert.ok(!stored.includes('"'+code+'"'));assert.equal(c.attempts,0);
  const r=await f.req('/api/auth/code/verify',{email,code});assert.equal(r.status,200);
  assert.match(r.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax; Max-Age=2592000/);assert.equal(r.headers.get('Cache-Control'),'no-store');
  const session=(await f.req('/api/auth/session')).body;assert.equal(session.signedIn,true);assert.equal(session.email,'p•••@example.com');assert.equal(session.hash,undefined);
  assert.equal((await f.req('/api/auth/code/verify',{email,code})).status,401);
  assert.equal((await f.req('/api/auth/signout',{})).status,200);assert.equal((await f.req('/api/auth/session')).body.signedIn,false);
});

test('fifth wrong attempt exhausts challenge; expiry and resends replace codes',async t=>{
  const f=fixture(t);await f.store('/code/start',{hash:'h',ip:'ip',digest:'right'});
  for(let i=0;i<5;i++)assert.equal((await f.store('/code/verify',{hash:'h',digest:'wrong'})).status,401);
  assert.equal((await f.store('/code/verify',{hash:'h',digest:'right'})).status,401);
  await f.store('/code/start',{hash:'h',ip:'ip',digest:'new'});
  assert.equal((await f.store('/code/verify',{hash:'h',digest:'right'})).status,401);
  assert.equal((await f.store('/code/verify',{hash:'h',digest:'new'})).status,200);
  await f.store('/code/start',{hash:'h',ip:'ip',digest:'expired'});
  f.db.prepare("UPDATE challenges SET data=json_set(data,'$.exp',?) WHERE hash=?").run(Date.now()-1,'h');
  assert.equal((await f.store('/code/verify',{hash:'h',digest:'expired'})).status,401);
});

test('address, IP and daily mail limits persist and expire',async t=>{
  const f=fixture(t);for(let i=0;i<3;i++)assert.equal((await f.store('/code/start',{hash:'same',ip:'a'+i,digest:'d'})).status,200);
  assert.equal((await f.store('/code/start',{hash:'same',ip:'other',digest:'d'})).status,429);
  for(let i=0;i<10;i++)assert.equal((await f.store('/code/start',{hash:'h'+i,ip:'shared',digest:'d'})).status,200);
  assert.equal((await f.store('/code/start',{hash:'h11',ip:'shared',digest:'d'})).status,429);
  f.db.prepare('UPDATE account_limits SET until=?').run(Date.now()-1);
  assert.equal((await f.store('/code/start',{hash:'same',ip:'shared',digest:'d'})).status,200);
  for(let i=0;i<500;i++)assert.equal((await f.store('/mail-reserve')).status,200);
  assert.equal((await f.store('/mail-reserve')).status,429);await f.store('/mail-failed');
  assert.deepEqual((await f.store('/stats')).body.daily.map(({sent,failed})=>({sent,failed})),[{sent:500,failed:1}]);
});

test('test sink is localhost-only, JSON/origin boundaries and delivery failures',async t=>{
  const f=fixture(t);
  assert.equal((await f.req('/api/auth/code/send',{email:'a@example.com'},{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.req('/api/auth/code/send',{email:'a@example.com'},{'Content-Type':'text/plain'})).status,415);
  assert.equal((await f.req('/api/auth/code/send',{email:'a'.repeat(4100)})).status,413);
  const remote=await routeAuth(new Request('https://public.example/api/auth/config'),f.env);assert.equal((await remote.json()).email,false);
  const sink=await routeAuth(new Request('https://public.example/api/auth/test/last-message?email=a@example.com'),f.env);assert.notEqual(sink.status,200);
  f.env.EMAIL_TEST_SINK='0';f.env.RESEND_API_KEY='fake-local-key';
  const r=await f.req('/api/auth/code/send',{email:'failed@example.com'},{},async(url)=>{assert.equal(url,'https://api.resend.com/emails');return new Response('',{status:500});});assert.equal(r.status,503);
  assert.equal((await f.store('/stats')).body.daily[0].failed,1);
});

test('cross-family recovery, account parent access and unlink isolation',async t=>{
  const f=fixture(t),a=await f.create('A');await f.login('parent@example.com',a);
  const b=await f.create('B');f.jar.delete('parent');
  assert.equal((await f.req('/api/admin/export')).status,200);
  const recovered=(await f.req('/api/auth/recover')).body.families;assert.equal(recovered.length,2);
  const ah=await sha256(a),bh=await sha256(b);assert.equal((await f.req('/api/auth/open',{hash:ah})).body.code,a);
  assert.equal((await f.req('/api/auth/open',{hash:'unlinked'})).status,403);
  const hash=await sha256('parent@example.com');await f.req('/api/auth/unlink',{familyCode:b,parentHash:hash});
  assert.equal((await f.req('/api/admin/export')).status,401);
  assert.deepEqual((await f.req('/api/auth/recover')).body.families.map(x=>x.hash),[ah]);assert.notEqual(ah,bh);
  f.setFamily(a);assert.equal((await f.req('/api/admin/export')).status,200);
});

test('linking requires existing unlocked family; fifth parent and sixth family rejected',async t=>{
  const f=fixture(t),code=await f.create();await f.req('/api/parent/lock',{});await f.login();
  assert.equal((await f.req('/api/auth/link',{familyCode:generateFamilyCode()})).status,404);
  assert.equal((await f.req('/api/auth/link',{familyCode:code})).status,401);
  await f.req('/api/parent/unlock',{pin:'1234'});assert.equal((await f.req('/api/auth/link',{familyCode:code})).status,200);
  const hash=await sha256('parent@example.com');
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
  assert.equal((await f.req('/api/auth/test/last-message?email=parent@example.com')).body.message,null);
  await f.login();f.jar.set('fp_account',token);assert.equal((await f.req('/api/auth/session')).body.signedIn,false);
});

async function oauth(f){f.env.GOOGLE_CLIENT_ID='local-client';f.env.GOOGLE_CLIENT_SECRET='local-secret';const start=await f.req('/auth/google/start');assert.equal(start.status,302);const target=new URL(start.headers.get('Location'));return {start,target,flow:await readValue(f.env.SESSION_SECRET,'oauth',f.jar.get('fp_oauth'))};}
const idToken=claims=>'unsigned.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.mock';
test('Google state is checked before exchange; PKCE verifier and verified claims bind identity',async t=>{
  const f=fixture(t),{start,target,flow}=await oauth(f);assert.match(start.headers.get('Set-Cookie'),/Path=\/auth\/google; HttpOnly; Secure; SameSite=Lax/);
  const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(flow.verifier))).toString('base64url');
  assert.equal(target.searchParams.get('code_challenge'),challenge);assert.equal(target.searchParams.get('code_challenge_method'),'S256');
  let calls=0;const exchange=async(url,options)=>{calls++;assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(options.redirect,'error');assert.equal(options.body.get('code_verifier'),flow.verifier);assert.equal(options.body.get('redirect_uri'),'http://localhost/auth/google/callback');return Response.json({id_token:idToken({email:'google@example.com',email_verified:true,sub:'subject',aud:'local-client',iss:'https://accounts.google.com',exp:Date.now()/1000+600})});};
  assert.equal((await f.req('/auth/google/callback?code=mock&state=wrong',undefined,{},exchange)).status,401);assert.equal(calls,0);
  const r=await f.req('/auth/google/callback?code=mock&state='+flow.state,undefined,{},exchange);assert.equal(r.status,302);assert.equal(calls,1);assert.equal(f.jar.get('fp_oauth'),'');assert.equal((await f.req('/api/auth/session')).body.signedIn,true);
});

test('Google rejects unverified, expired, wrong audience/issuer, malformed and failed exchange',async t=>{
  const f=fixture(t),{flow}=await oauth(f),base={email:'google@example.com',email_verified:true,sub:'subject',aud:'local-client',iss:'accounts.google.com',exp:Date.now()/1000+600},callback='/auth/google/callback?code=mock&state='+flow.state;
  for(const override of [{email_verified:false},{email_verified:'true'},{exp:undefined},{exp:'not-a-number'},{exp:1},{aud:'other'},{iss:'https://evil.example'},{sub:''}]){
    assert.equal((await f.req(callback,undefined,{},async()=>Response.json({id_token:idToken({...base,...override})}))).status,401);
  }
  assert.equal((await f.req(callback,undefined,{},async()=>Response.json({id_token:'bad'}))).status,401);
  assert.equal((await f.req(callback,undefined,{},async()=>new Response('',{status:400}))).status,401);
  assert.equal((await f.req('/api/auth/session')).body.signedIn,false);
});


test('Google subject cannot be replaced for an existing account',async t=>{
  const f=fixture(t);assert.equal((await f.store('/login',{hash:'h',email:'p@example.com',sub:'original'})).status,200);
  assert.equal((await f.store('/login',{hash:'h',email:'p@example.com',sub:'different'})).status,403);
  assert.equal((await f.store('/get',{hash:'h'})).body.account.google_sub,'original');
});


test('Lock signs out account access; pending link proofs cannot restore a revoked parent',async t=>{
 const f=fixture(t),code=await f.create(),email='parent@example.com';const {hash}=await f.login(email,code);
 await f.req('/api/auth/code/send',{email,familyCode:code});
 const message=(await f.req('/api/auth/test/last-message?email='+email)).body.message;
 const pendingCode=message.text.match(/\b\d{6}\b/)[0];
 assert.equal((await f.req('/api/auth/unlink',{familyCode:code,parentHash:hash})).status,200);f.jar.delete('parent');
 assert.equal((await f.req('/api/auth/code/verify',{email,code:pendingCode})).status,403);
 assert.equal((await f.req('/api/admin/export')).status,401);
 await f.req('/api/parent/unlock',{pin:'1234'});await f.req('/api/auth/link',{familyCode:code});f.jar.delete('parent');
 assert.equal((await f.req('/api/admin/export')).status,200);
 assert.equal((await f.req('/api/parent/lock',{})).status,200);
 assert.equal((await f.req('/api/auth/session')).body.signedIn,false);
 assert.equal((await f.req('/api/admin/export')).status,401);
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

test('pending Google linking proof is invalid after unlink',async t=>{
 const f=fixture(t),code=await f.create(),email='google@example.com';const {hash}=await f.login(email,code);
 f.env.GOOGLE_CLIENT_ID='local-client';f.env.GOOGLE_CLIENT_SECRET='local-secret';
 const start=await f.req('/auth/google/start?familyCode='+encodeURIComponent(code));assert.equal(start.status,302);
 const flow=await readValue(f.env.SESSION_SECRET,'oauth',f.jar.get('fp_oauth'));
 await f.req('/api/auth/unlink',{familyCode:code,parentHash:hash});f.jar.delete('parent');
 const r=await f.req('/auth/google/callback?code=mock&state='+flow.state,undefined,{},async()=>Response.json({id_token:idToken({email,email_verified:true,sub:'subject',aud:'local-client',iss:'https://accounts.google.com',exp:Date.now()/1000+600})}));
 assert.equal(r.status,403);assert.equal((await f.req('/api/admin/export')).status,401);
});

test('family deletion removes identity links and still requires the fresh PIN',async t=>{
 const f=fixture(t),a=await f.create('A');await f.login('parent@example.com',a);await f.create('B');
 assert.equal((await f.req('/api/admin/delete-family',{pin:'0000',confirmation:'B'})).status,401);
 assert.equal((await f.req('/api/admin/delete-family',{pin:'1234',confirmation:'B'})).status,200);
 const families=(await f.req('/api/auth/recover')).body.families;assert.deepEqual(families.map(x=>x.code),[a]);
});
