// Run against a disposable local Worker with EMAIL_TEST_SINK=1. Never contacts email/Google.
// SMOKE_URL=http://localhost:8792 node cloudflare/signin-smoke.mjs
import assert from 'node:assert/strict';
const origin=process.env.SMOKE_URL||'http://localhost:8792';
const url=new URL(origin);
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('Disposable localhost Worker only');
const suffix=crypto.randomUUID(),ip=`198.18.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*254)+1}`;
let checks=0,passed=false;
const eq=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
const client=()=>({code:'',jar:new Map()});
const parent=client(),fresh=client(),stranger=client(),families=[];
async function req(c,path,data,extra={}){
 const r=await fetch(new URL(path,origin),{method:data===undefined?'GET':'POST',redirect:'manual',headers:{'Content-Type':'application/json','CF-Connecting-IP':ip,'X-Family-Code':c.code,Cookie:[...c.jar].map(([k,v])=>`${k}=${v}`).join('; '),...extra},body:data===undefined?undefined:JSON.stringify(data)});
 for(const cookie of r.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');c.jar.set(pair.slice(0,i),pair.slice(i+1));}
 const text=await r.text();return {status:r.status,headers:r.headers,body:r.headers.get('Content-Type')?.includes('json')?JSON.parse(text):text};
}
async function ok(c,path,data,status=200){const r=await req(c,path,data);assert.equal(r.status,status,`${path}: ${JSON.stringify(r.body)}`);checks++;return r;}
async function login(c,email,familyCode){
 await ok(c,'/api/auth/code/send',{email,...(familyCode?{familyCode}:{})});
 const message=(await ok(c,'/api/auth/test/last-message?email='+encodeURIComponent(email))).body.message;
 assert.equal(message.to,email);checks++;const code=message.text.match(/\b\d{6}\b/)?.[0];assert.match(code,/^\d{6}$/);checks++;
 const signed=await ok(c,'/api/auth/code/verify',{email,code});assert.match(signed.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);checks++;
 eq((await req(c,'/api/auth/code/verify',{email,code})).status,401);
}
const email=`signin-${suffix}@example.com`,secondEmail=`signin-other-${suffix}@example.com`;
try{
 eq((await ok(parent,'/api/auth/config')).body.email,true);
 eq((await ok(parent,'/api/auth/session')).body.signedIn,false);
 eq((await req(parent,'/api/auth/code/send',{email},{Origin:'https://evil.example'})).status,403);
 // First login attaches only a family already unlocked in this browser.
 const a=(await ok(parent,'/api/families',{name:'Sign-in smoke A',pin:'1234'},201)).body.code;
 parent.code=a;families.push({code:a,name:'Sign-in smoke A'});
 await ok(parent,'/api/parent/lock',{});
 eq((await req(parent,'/api/auth/code/send',{email,familyCode:a})).status,401);
 await ok(parent,'/api/parent/unlock',{pin:'1234'});await login(parent,email,a);
 const b=(await ok(parent,'/api/families',{name:'Sign-in smoke B',pin:'1234'},201)).body.code;
 parent.code=b;families.push({code:b,name:'Sign-in smoke B'});
 await ok(parent,'/api/parent/lock',{});parent.jar.delete('parent');
 eq((await ok(parent,'/api/state')).body.parent,true);await ok(parent,'/api/admin/export');
 const recovery=(await ok(parent,'/api/auth/recover')).body.families;eq(recovery.length,2);
 eq(recovery.map(f=>f.code).sort(),[a,b].sort());
 const ah=recovery.find(f=>f.code===a).hash,bh=recovery.find(f=>f.code===b).hash;
 eq((await ok(parent,'/api/auth/open',{hash:ah})).body.code,a);
 eq((await req(parent,'/api/auth/open',{hash:'not-linked'})).status,403);
 // Browser recovery after signout restores both families without either PIN.
 await ok(parent,'/api/auth/signout',{});eq((await ok(parent,'/api/auth/session')).body.signedIn,false);
 eq((await req(parent,'/api/admin/export')).status,401);
 await login(fresh,email);eq((await ok(fresh,'/api/auth/recover')).body.families.length,2);
 fresh.code=a;await ok(fresh,'/api/admin/export');
 stranger.code=a;eq((await req(stranger,'/api/admin/export')).status,401);
 eq((await req(stranger,'/api/admin/export',undefined,{'X-Internal-Account-Parent':'1'})).status,401);
 await ok(fresh,'/api/auth/prefs',{weekly:true,classUpdates:true,review:false,timezone:'UTC'});
 eq((await ok(fresh,'/api/auth/session')).body.prefs,{weekly:true,classUpdates:true,review:false,timezone:'UTC'});
 // A second parent can attach only after family PIN unlock. Unlink revokes that account only.
 await ok(stranger,'/api/parent/unlock',{pin:'1234'});await login(stranger,secondEmail,a);stranger.jar.delete('parent');
 const parents=(await ok(fresh,'/api/auth/parents')).body.parents;eq(parents.length,2);
 // Both generated emails have the same masked form, so use account recovery and delete for second-parent cleanup.
 await ok(stranger,'/api/auth/delete',{});eq((await ok(stranger,'/api/auth/session')).body.signedIn,false);
 eq((await ok(fresh,'/api/auth/parents')).body.parents.length,1);
 fresh.code=b;const remaining=(await ok(fresh,'/api/auth/parents')).body.parents;
 await ok(fresh,'/api/auth/unlink',{familyCode:b,parentHash:remaining[0].hash});
 eq((await req(fresh,'/api/admin/export')).status,401);
 eq((await ok(fresh,'/api/auth/recover')).body.families.map(f=>f.hash),[ah]);
 eq((await req(fresh,'/api/auth/open',{hash:bh})).status,403);
 fresh.code=a;await ok(fresh,'/api/admin/export');
 const oldToken=fresh.jar.get('fp_account');await ok(fresh,'/api/auth/delete',{});
 fresh.jar.set('fp_account',oldToken);eq((await ok(fresh,'/api/auth/session')).body.signedIn,false);fresh.jar.delete('fp_account');
 eq((await ok(fresh,'/api/auth/test/last-message?email='+encodeURIComponent(email))).body.message,null);
 passed=true;
}finally{
 // Best effort account cleanup, then delete each disposable family with its PIN.
 for(const c of [fresh,stranger,parent])if(c.jar.get('fp_account'))await req(c,'/api/auth/delete',{});
 for(const f of families){const c=client();c.code=f.code;await ok(c,'/api/parent/unlock',{pin:'1234'});await ok(c,'/api/admin/delete-family',{pin:'1234',confirmation:f.name});}
}

if(passed)console.log(`PASS: ${checks} checks; local sink, one-use codes, cookies, two-family recovery, parent gates, preferences, unlink, deletion and cleanup.`);
