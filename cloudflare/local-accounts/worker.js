// LOCAL TEST DOUBLE ONLY. Never bind or deploy this Worker to production.
import {WorkerEntrypoint, DurableObject} from 'cloudflare:workers';
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const local=u=>['localhost','127.0.0.1'].includes(new URL(u).hostname);
const cookie=(v,age=3600)=>`__Host-jl_sso=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const token=()=>crypto.randomUUID();
const digest=async s=>btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const stub=env=>{if(env.ENVIRONMENT!=='dev'||!local(env.APP_ORIGIN))throw Error('Local fake disabled');return env.FAKE.get(env.FAKE.idFromName('local'));};
export class SpellingClient extends WorkerEntrypoint {
 startEmail(i){return stub(this.env).rpc('startEmail',i);}
 verifyEmail(i){return stub(this.env).rpc('verifyEmail',i);}
 exchangeCode(i){return stub(this.env).rpc('exchangeCode',i);}
 getUser(i){return stub(this.env).rpc('getUser',i);}
 deleteLink(i){return stub(this.env).rpc('deleteLink',i);}
 importIdentity(i){return stub(this.env).rpc('importIdentity',i);}
}
export class FakeAccounts extends DurableObject {
 async rpc(method,i){return this.ctx.blockConcurrencyWhile(async()=>{
  const s=this.ctx.storage;
  const user=async email=>{let u=await s.get('email:'+email);const isNew=!u;if(!u){u={sub:'jl1_local_'+await digest(email),email,hasGoogle:false,clients:['spelling']};await s.put('email:'+email,u);await s.put('user:'+u.sub,u);}return {...u,isNew};};
  if(method==='startEmail'){if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email||''))return {error:'invalid_email'};await s.put('code:'+i.email,{expires:Date.now()+600000});return {ok:true};}
  if(method==='verifyEmail'){const c=await s.get('code:'+i.email);if(!c||c.expires<Date.now()||i.code!=='123456')return {error:'invalid_code'};await s.delete('code:'+i.email);const u=await user(i.email),ssoTicket=token();await s.put('ticket:'+ssoTicket,{sub:u.sub,expires:Date.now()+60000});return {...u,ssoTicket};}
  if(method==='exchangeCode'){const g=await s.get('grant:'+i.code);await s.delete('grant:'+i.code);if(!g||g.expires<Date.now()||g.uri!==i.redirectUri||g.challenge!==await digest(i.codeVerifier))return {error:'invalid_grant'};const u=await s.get('user:'+g.sub);return u?{...u,isNew:g.isNew}:{error:'invalid_grant'};}
  if(method==='getUser')return (await s.get('user:'+i.sub))||null;
  if(method==='deleteLink'){const u=await s.get('user:'+i.sub);if(!u)return {deleted:'none'};await s.delete(['user:'+i.sub,'email:'+u.email]);return {deleted:'user'};}
  if(method==='importIdentity')return i.email?user(i.email):{error:'invalid_identity'};
  if(method==='google'){const u=await user(i.email);u.hasGoogle=true;await s.put('email:'+i.email,u);await s.put('user:'+u.sub,u);return u;}
  return {error:'invalid_method'};
 });}
 async fetch(request){const u=new URL(request.url),p=u.searchParams,s=this.ctx.storage;
  if(!local(request.url)||this.env.ENVIRONMENT!=='dev')return json({error:'Local fake disabled'},403);
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  if(u.pathname==='/health')return json({fake:true,emailCode:'123456'});
  const redirect=(target,session)=>{const h=new Headers({Location:target,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});if(session!==undefined)h.set('Set-Cookie',cookie(session,session?3600:0));return new Response(null,{status:303,headers:h});};
  const returnTo=()=>{const path=p.get('return')||'/';return path.startsWith('/')&&!path.startsWith('//')&&!path.includes('\\')?new URL(path,this.env.APP_ORIGIN).href:null;};
  const raw=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-jl_sso=([^;]+)/)?.[1];
  if(u.pathname==='/sso/attach'){const key='ticket:'+p.get('ticket'),t=await s.get(key);await s.delete(key);if((p.has('client')&&p.get('client')!=='spelling')||!t||t.expires<Date.now()||!await s.get('user:'+t.sub)||!returnTo())return json({error:'invalid_ticket'},400);const session=token();await s.put('sso:'+session,t.sub);return redirect(returnTo(),session);}
  if(u.pathname==='/sso/logout'){if(p.get('client')!=='spelling')return json({error:'invalid_client'},400);await s.delete('sso:'+raw);return returnTo()?redirect(returnTo(),''):json({error:'invalid_return'},400);}
  if(u.pathname==='/authorize'){
   const uri=p.get('redirect_uri')||'',state=p.get('state'),challenge=p.get('code_challenge')||'';
   if(p.get('client')!=='spelling'||uri!==this.env.APP_ORIGIN+'/auth/jesklabs/callback'||!state||!/^[\w-]{43}$/.test(challenge)||p.get('code_challenge_method')!=='S256')return json({error:'invalid_request'},400);
   let sub=await s.get('sso:'+raw),isNew=false;
   if(p.get('provider')==='google'){const user=await this.rpc('google',{email:this.env.GOOGLE_EMAIL||'google-local@example.com'});sub=user.sub;isNew=user.isNew;}
   else if(p.get('prompt')!=='none')return json({error:'invalid_request'},400);
   const back=new URL(uri);back.searchParams.set('state',state);
   if(!sub||!await s.get('user:'+sub)){back.searchParams.set('error','login_required');return redirect(back.href);}
   const code=token();await s.put('grant:'+code,{sub,uri,challenge,isNew,expires:Date.now()+60000});back.searchParams.set('code',code);const session=token();await s.put('sso:'+session,sub);return redirect(back.href,session);
  }
  return json({error:'not_found'},404);
 }
}
export default {fetch(request,env){return stub(env).fetch(request);}};
