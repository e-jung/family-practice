// Disposable local app + local-accounts/SpellingClient only. No provider traffic.
// See cloudflare/local-accounts/README.md for launch instructions.
import assert from 'node:assert/strict';
const origin=process.env.SMOKE_URL||'http://localhost:8792';
const accounts=process.env.SMOKE_ACCOUNTS_URL||'http://localhost:8793';
for(const value of [origin,accounts]){const u=new URL(value);if(!['localhost','127.0.0.1'].includes(u.hostname)||u.username||u.password)throw Error('Disposable localhost Workers only');}
const ip=`198.18.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*254)+1}`;
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const client=()=>({code:'',jar:new Map()});
const parent=client(),fresh=client(),stranger=client(),families=[];
async function req(c,path,data,extra={}){
 const target=new URL(path,origin);assert.ok([origin,accounts].includes(target.origin),'no external requests');
 const r=await fetch(target,{method:data===undefined?'GET':'POST',redirect:'manual',headers:{'Content-Type':'application/json',...(data===undefined?{}:{Origin:target.origin}),'CF-Connecting-IP':ip,'X-Family-Code':c.code,Cookie:[...c.jar].map(([k,v])=>`${k}=${v}`).join('; '),...extra},body:data===undefined?undefined:JSON.stringify(data)});
 for(const cookie of r.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');if(/Max-Age=0(?:;|$)/i.test(cookie))c.jar.delete(pair.slice(0,i));else c.jar.set(pair.slice(0,i),pair.slice(i+1));}
 const text=await r.text();return {status:r.status,headers:r.headers,body:r.headers.get('Content-Type')?.includes('json')?JSON.parse(text):text};
}
async function ok(c,path,data,status=200){const r=await req(c,path,data);assert.equal(r.status,status,`${path}: ${JSON.stringify(r.body)}`);checks++;return r;}
async function hop(c,url){for(let i=0;i<8;i++){const r=await req(c,url);if(r.status<300||r.status>=400)return {url:new URL(url,origin),...r};url=new URL(r.headers.get('Location'),url).href;if(new URL(url).origin===origin&&new URL(url).pathname==='/')return {url:new URL(url),...r};}throw Error('Redirect loop');}
async function login(c,email,familyCode){await ok(c,'/api/auth/code/send',{email,...(familyCode?{familyCode}:{})});const verified=await ok(c,'/api/auth/code/verify',{email,code:'123456'});assert.match(verified.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);checks++;eq((await req(c,'/api/auth/code/verify',{email,code:'123456'})).status,401);assert.equal(new URL(verified.body.attachUrl).origin,accounts);await hop(c,verified.body.attachUrl);eq((await ok(c,'/api/auth/session')).body.signedIn,true);}
async function oauth(c,mode){const start=await ok(c,'/api/auth/start',{mode});assert.equal(new URL(start.body.url).origin,accounts);return hop(c,start.body.url);}
const suffix=crypto.randomUUID(),email=`signin-${suffix}@example.com`,secondEmail=`second-${suffix}@example.com`;
try{
 eq((await ok(parent,accounts+'/health')).body.fake,true);
 const config=(await ok(parent,'/api/auth/config')).body;eq(config.email,true);eq(config.google,true);
 eq((await ok(parent,'/api/auth/session')).body.signedIn,false);
 eq((await req(parent,'/api/auth/code/send',{email},{Origin:'https://evil.example'})).status,403);
 eq((await oauth(stranger,'sso')).url.searchParams.get('auth'),'signin');
 eq((await req(stranger,'/api/auth/confirm',{})).status,401);
 const a=(await ok(parent,'/api/families',{name:'Sign-in smoke A',pin:'1234'},201)).body.code;parent.code=a;families.push({code:a,name:'Sign-in smoke A'});
 await ok(parent,'/api/parent/lock',{});eq((await req(parent,'/api/auth/code/send',{email,familyCode:a})).status,401);
 await ok(parent,'/api/parent/unlock',{pin:'1234'});await login(parent,email,a);
 const b=(await ok(parent,'/api/families',{name:'Sign-in smoke B',pin:'1234'},201)).body.code;parent.code=b;families.push({code:b,name:'Sign-in smoke B'});await ok(parent,'/api/auth/link',{familyCode:b});parent.jar.delete('parent');
 eq((await ok(parent,'/api/state')).body.parent,true);
 const recovery=(await ok(parent,'/api/auth/recover')).body.families;eq(recovery.map(f=>f.code).sort(),[a,b].sort());const ah=recovery.find(f=>f.code===a).hash,bh=recovery.find(f=>f.code===b).hash;
 await ok(parent,'/api/auth/signout',{});eq((await ok(parent,'/api/auth/session')).body.signedIn,false);
 // App logout alone intentionally leaves shared SSO; no app session before consent.
 eq((await oauth(parent,'sso')).url.searchParams.get('auth'),'confirm');eq((await ok(parent,'/api/auth/session')).body.signedIn,false);assert.ok((await ok(parent,'/api/auth/pending')).body.email);checks++;
 await ok(parent,'/api/auth/decline',{});eq((await ok(parent,'/api/auth/session')).body.signedIn,false);
 eq((await oauth(parent,'sso')).url.searchParams.get('auth'),'confirm');await ok(parent,'/api/auth/confirm',{});eq((await ok(parent,'/api/auth/session')).body.signedIn,true);eq((await req(parent,'/api/auth/confirm',{})).status,401);
 await login(fresh,email);eq((await ok(fresh,'/api/auth/recover')).body.families.length,2);fresh.code=a;await ok(fresh,'/api/admin/export');stranger.code=a;eq((await req(stranger,'/api/admin/export')).status,401);
 await ok(fresh,'/api/auth/prefs',{weekly:true,classUpdates:true,review:false,timezone:'UTC'});eq((await ok(fresh,'/api/auth/session')).body.prefs,{weekly:true,classUpdates:true,review:false,timezone:'UTC'});
 await ok(stranger,'/api/parent/unlock',{pin:'1234'});await login(stranger,secondEmail,a);stranger.jar.delete('parent');eq((await ok(fresh,'/api/auth/parents')).body.parents.length,2);await ok(stranger,'/api/auth/delete',{});eq((await ok(fresh,'/api/auth/parents')).body.parents.length,1);
 fresh.code=b;const parents=(await ok(fresh,'/api/auth/parents')).body.parents;await ok(fresh,'/api/auth/unlink',{familyCode:b,parentHash:parents[0].hash});eq((await req(fresh,'/api/admin/export')).status,401);eq((await ok(fresh,'/api/auth/recover')).body.families.map(f=>f.hash),[ah]);eq((await req(fresh,'/api/auth/open',{hash:bh})).status,403);
 await ok(fresh,'/api/auth/delete',{});eq((await ok(fresh,'/api/auth/session')).body.signedIn,false);
 // Google uses a local fake identity and a real app state/PKCE callback.
 const google=client();eq((await oauth(google,'google')).url.searchParams.get('signedIn'),'1');eq((await ok(google,'/api/auth/session')).body.signedIn,true);await ok(google,'/api/auth/delete',{});
 await hop(parent,accounts+'/sso/logout?client=spelling&return=/');await ok(parent,'/api/auth/signout',{});eq((await oauth(parent,'sso')).url.searchParams.get('auth'),'signin');
}finally{for(const c of [fresh,stranger,parent])await req(c,'/api/auth/delete',{});for(const f of families){const c=client();c.code=f.code;await ok(c,'/api/parent/unlock',{pin:'1234'});await ok(c,'/api/admin/delete-family',{pin:'1234',confirmation:f.name});}}
console.log(`PASS: ${checks} checks; local Accounts RPC, one-use email codes, Google/SSO consent+decline, family linking, recovery, preferences, unlink, delete, logout and cleanup.`);
