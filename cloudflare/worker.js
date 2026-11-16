import {verseMastery,VERSE_MASTERY_POLICY} from './public/verse-mastery.js';
import {settingsFor} from './runtime-settings.js';
import {scheduledEmails} from './notifications.js';
import {routeAuth,authConfig,accountSession,accountRequest,linkFamily,accountsRpc} from './accounts.js';
export {AccountStore} from './accounts.js';
import {shareRequest,validSlug} from './sharing.js';
export {ShareStore} from './sharing.js';
import {routeToken,decryptRoute,retiredToken,RETIRED_LINK} from './mcp.js';
import { tts } from './tts.js';
import {legacyResponse} from './legacy.js';
export { TtsCache } from './tts.js';
import { createHandler } from './core.js';
import {sha256,generateFamilyCode,normalizeCode,validCode,equalSecret} from './auth.js';
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}});
export class FamilyDatabase {
  constructor(ctx,env) { this.ctx=ctx;this.env={...env};this.handler=createHandler(ctx,this.env);this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS linked_parents(hash TEXT PRIMARY KEY,masked TEXT NOT NULL); CREATE TABLE IF NOT EXISTS account_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');this.ctx.storage.sql.exec('INSERT OR IGNORE INTO account_meta VALUES(?,?)','link_epoch',crypto.randomUUID()); }
  fetch(request) {
    return this.ctx.blockConcurrencyWhile(async()=> {
      this.env.familyIdHash=request.headers.get('X-Internal-Family-Hash');
      this.env.familyCode=request.headers.get('X-Family-Code');
      this.env.sharingIpHash=request.headers.get('X-Internal-Sharing-IP');
      this.env.accountParent=request.headers.get('X-Internal-Account-Parent')==='1';
      const sql=this.ctx.storage.sql, path=new URL(request.url).pathname;
      if(path.startsWith('/api/internal/account/')) {
        const family=[...sql.exec('SELECT * FROM family WHERE id=1')][0];if(!family)return json({error:'Family not found'},404);
        const b=await request.json(),op=path.split('/').pop();
        const linkEpoch=[...sql.exec("SELECT value FROM account_meta WHERE key='link_epoch'")][0].value;
        if(op==='proof')return json({epoch:linkEpoch});
        if(op==='link'){if(b.epoch&&b.epoch!==linkEpoch)return json({error:'Family linking expired; unlock Parent mode and try again'},403);if(![...sql.exec('SELECT hash FROM linked_parents WHERE hash=?',b.hash)].length&&[...sql.exec('SELECT hash FROM linked_parents')].length>=4)return json({error:'At most four parents per family'},409);sql.exec('INSERT OR REPLACE INTO linked_parents VALUES(?,?)',b.hash,b.masked);return json({name:family.name});}
        if(op==='open'){if(![...sql.exec('SELECT hash FROM linked_parents WHERE hash=?',b.hash)].length)return json({error:'Family not linked'},403);return json({ok:true});}
        if(op==='unlink'){sql.exec('DELETE FROM linked_parents WHERE hash=?',b.hash);sql.exec("UPDATE account_meta SET value=? WHERE key='link_epoch'",crypto.randomUUID());return json({ok:true});}
        if(op==='follows')return json({follows:[...sql.exec('SELECT slug FROM class_follows ORDER BY slug')]});
        if(op==='parents')return json({parents:[...sql.exec('SELECT hash,masked FROM linked_parents ORDER BY masked')]});
        if(op==='digest') {
          const since=new Date(Date.now()-7*86400000).toISOString(),today=new Date().toISOString().slice(0,10);
          const kids=[...sql.exec('SELECT id,name FROM kids WHERE archived=0')].map(k=>{
            const verses=[...sql.exec('SELECT id,text,reference FROM verses WHERE kid_id=? AND archived=0',k.id)];
            const stars = before => verses.reduce((sum, verse) => {
              const recent = [...sql.exec(`SELECT verse_id,verse_text,verse_reference,mode,accuracy FROM verse_attempts
                WHERE kid_id=? AND verse_id=? AND verse_text=? AND verse_reference=? AND created_at<?
                ORDER BY id DESC LIMIT ?`, k.id, verse.id, verse.text, verse.reference, before, VERSE_MASTERY_POLICY.recentAttempts)];
              return sum + verseMastery(verse, recent).stars;
            }, 0);
            const days=new Set([...sql.exec('SELECT substr(created_at,1,10) day FROM attempts WHERE kid_id=? UNION SELECT substr(created_at,1,10) day FROM verse_attempts WHERE kid_id=? ORDER BY day DESC LIMIT 366',k.id,k.id)].map(d=>d.day));let streak=0,day=new Date(today+'T00:00:00Z');if(!days.has(today))day.setUTCDate(day.getUTCDate()-1);while(days.has(day.toISOString().slice(0,10))&&streak<366){streak++;day.setUTCDate(day.getUTCDate()-1);}
            const practiceDays=[...sql.exec('SELECT COUNT(DISTINCT day) n FROM (SELECT substr(created_at,1,10) day FROM attempts WHERE kid_id=? AND created_at>=? UNION SELECT substr(created_at,1,10) day FROM verse_attempts WHERE kid_id=? AND created_at>=?)',k.id,since,k.id,since)][0].n;
            return {...k,streak,practiceDays,verseStarsChange:stars(new Date().toISOString())-stars(since),lists:[...sql.exec('SELECT DISTINCT l.title FROM lists l JOIN attempts a ON a.list_id=l.id WHERE a.kid_id=? AND a.created_at>=?',k.id,since)].map(x=>x.title),attempts:[...sql.exec("SELECT correct,first_try,word FROM attempts WHERE kid_id=? AND created_at>=? AND mode='test'",k.id,since)],reviewDue:[...sql.exec('SELECT COUNT(*) n FROM word_bank WHERE kid_id=? AND due<=?',k.id,today)][0].n};
          });return json({name:family.name,kids});
        }
        return json({error:'Not found'},404);
      }
      const oldParents=path==='/api/admin/delete-family'?[...sql.exec('SELECT hash FROM linked_parents')]:[];
      const response=await this.handler(request);
      if(response.ok&&oldParents.length){for(const p of oldParents)await accountRequest(this.env,'/unlink',{hash:p.hash,familyHash:this.env.familyIdHash});sql.exec('DELETE FROM linked_parents');}
      const day=new Date().toISOString().slice(0,10);
      const exists=[...sql.exec('SELECT id FROM family LIMIT 1')].length>0;
      // One report per active day, plus mutations; no per-family fanout for ops reads.
      if(exists && (request.method!=='GET' || this.reportDay!==day) || response.ok && new URL(request.url).pathname==='/api/admin/delete-family') {
        try {
          const report={family:this.env.familyIdHash,exists,active:[...sql.exec("SELECT day FROM ops_daily WHERE test+learn+verse>0 ORDER BY day DESC LIMIT 1")][0]?.day || "",
            created:Number([...sql.exec("SELECT value FROM ops_meta WHERE key='created'")][0]?.value||0),
            days:[...sql.exec('SELECT * FROM ops_daily WHERE day>=?',new Date(Date.now()-30*86400000).toISOString().slice(0,10))]};
          await this.env.REGISTRY.get(this.env.REGISTRY.idFromName('registry')).fetch(new Request('https://internal/report',{method:'POST',body:JSON.stringify(report)}));
          this.reportDay=day;
        } catch { /* Aggregate reporting must not block family practice. */ }
      }
      return response;
    });
  }
}
export class RegistryLimits {
  constructor(ctx, env = {}) {
    this.settings = settingsFor(env);
    this.ctx=ctx;this.sql=ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS ops_families(hash TEXT PRIMARY KEY,created INTEGER NOT NULL,active TEXT NOT NULL); CREATE TABLE IF NOT EXISTS ops_family_days(hash TEXT NOT NULL,day TEXT NOT NULL,test INTEGER NOT NULL,learn INTEGER NOT NULL,verse INTEGER NOT NULL,pin_lockouts INTEGER NOT NULL,PRIMARY KEY(hash,day)); CREATE TABLE IF NOT EXISTS ops_voice(day TEXT PRIMARY KEY,synthesized_characters INTEGER NOT NULL DEFAULT 0,cache_hits INTEGER NOT NULL DEFAULT 0,quota_429 INTEGER NOT NULL DEFAULT 0)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL)');
  }
  fetch(request) {
    return this.ctx.blockConcurrencyWhile(async()=> {
      const path=new URL(request.url).pathname, today=new Date().toISOString().slice(0,10);
      this.sql.exec('DELETE FROM ops_family_days WHERE day<?',new Date(Date.now()-30*86400000).toISOString().slice(0,10));
      this.sql.exec('DELETE FROM ops_voice WHERE day<?',new Date(Date.now()-30*86400000).toISOString().slice(0,10));
      if(path==='/stats') {
        const ago=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
        const f=[...this.sql.exec('SELECT COUNT(*) total,COALESCE(SUM(created>=?),0) created7,COALESCE(SUM(created>=?),0) created30,COALESCE(SUM(active>=?),0) active7 FROM ops_families',Date.now()-7*86400000,Date.now()-30*86400000,ago(6))][0];
        const a=[...this.sql.exec('SELECT COALESCE(SUM(test),0) test,COALESCE(SUM(learn),0) learn,COALESCE(SUM(verse),0) verse,COALESCE(SUM(pin_lockouts),0) pin_lockouts FROM ops_family_days WHERE day>=?',ago(6))][0];
        const voiceDays=new Map([...this.sql.exec('SELECT * FROM ops_voice WHERE day>=? ORDER BY day DESC',ago(6))].map(row=>[row.day,row]));
        const ttsDaily=Array.from({length:7},(_,i)=>voiceDays.get(ago(i)) || {day:ago(i),synthesized_characters:0,cache_hits:0,quota_429:0});
        return json({asOf:new Date().toISOString(),coverage:'Families observed since aggregate reporting was enabled; pre-existing creation dates unknown. Windows use UTC days.',families:f,attempts7:{test:a.test,learn:a.learn,verse:a.verse},pinLockouts7:a.pin_lockouts,ttsDaily});
      }
      const payload=await request.json();
      if(path==='/report') {
        const {family,exists,created,active,days}=payload;
        if(!/^[a-f0-9]{64}$/.test(family)) return json({error:'Invalid report'},400);
        if(exists) this.sql.exec('INSERT INTO ops_families VALUES(?,?,?) ON CONFLICT(hash) DO UPDATE SET active=excluded.active',family,created,active);
        else this.sql.exec('DELETE FROM ops_families WHERE hash=?',family);
        for(const d of days) this.sql.exec('INSERT INTO ops_family_days VALUES(?,?,?,?,?,?) ON CONFLICT(hash,day) DO UPDATE SET test=excluded.test,learn=excluded.learn,verse=excluded.verse,pin_lockouts=excluded.pin_lockouts',family,d.day,d.test,d.learn,d.verse,d.pin_lockouts);
        return json({ok:true});
      }
      if(path==='/voice') {
        if(!['cache_hits','synthesized_characters','quota_429'].includes(payload.metric) || !Number.isSafeInteger(payload.count) || payload.count<1) return json({error:'Invalid metric'},400);
        this.sql.exec(`INSERT INTO ops_voice(day,${payload.metric}) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET ${payload.metric}=${payload.metric}+excluded.${payload.metric}`,today,payload.count);
        return json({ok:true});
      }
      const {kind,ip,family,characters}=payload;
      if(!['create','lookup-check','lookup-failed','tts','mcp','sharing-read','sharing-import','sharing-create'].includes(kind) || !/^[a-f0-9]{64}$/.test(ip)) return json({error:'Invalid limit'},400);
      const now=Date.now();this.sql.exec('DELETE FROM limits WHERE until<=?',now);
      const get=key=>[...this.sql.exec('SELECT * FROM limits WHERE key=?',key)][0];
      const quotaHit=()=>this.sql.exec('INSERT INTO ops_voice(day,quota_429) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET quota_429=quota_429+1',today);
      const bump=(key,ms)=>this.sql.exec('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',key,now+ms);
      if(kind.startsWith('sharing-')) {
        if(kind==='sharing-create'&&!/^[a-f0-9]{64}$/.test(family||''))return json({error:'Invalid limit'},400);
        const [key,max,ms]=kind==='sharing-read'?['sharing:read:'+ip,120,60000]:kind==='sharing-import'?['sharing:import:'+ip,60,3600000]:['sharing:create:'+family+':'+today,20,Date.parse(today+'T00:00:00Z')+86400000-now];
        if((get(key)?.count||0)>=max)return json({error:'Sharing rate limit reached'},429,{'Retry-After':String(Math.ceil(ms/1000))});
        bump(key,ms);
      } else if(kind==='mcp') {
        if((get('mcp:ip:'+ip)?.count||0)>=240 || (get('mcp:global')?.count||0)>=2400)return new Response(JSON.stringify({error:'Too many assistant requests'}),{status:429,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':'60'}});
        bump('mcp:ip:'+ip,60000);bump('mcp:global',60000);
      } else if(kind==='tts') {
        const budget = this.settings.voice;
        if (!/^[a-f0-9]{64}$/.test(family) || !Number.isInteger(characters) ||
            characters < 1 || characters > budget.request) return json({error:'Invalid limit'},400);
        const day=new Date(now).toISOString().slice(0,10), until=Date.parse(day+'T00:00:00Z')+86400000;
        const globalKey='tts:global:'+day+':chars', familyKey='tts:family:'+family+':'+day+':chars', ipKey='tts:ip:'+ip+':chars';
        if ((get(globalKey)?.count||0)+characters > budget.globalDaily ||
            (get(familyKey)?.count||0)+characters > budget.familyDaily ||
            (get(ipKey)?.count||0)+characters > budget.ipHourly) return json({error:'voice_quota'},429);

        // Serialized character reservation before inference. Failed inference counts too.
        for(const [key,expiry] of [[globalKey,until],[familyKey,until],[ipKey,now+3600000]]) {
          this.sql.exec('INSERT INTO limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+excluded.count',key,characters,expiry);
        }
      } else if(kind==='create') {
        if((get('create:'+ip)?.count||0)>=5 || (get('global')?.count||0)>=200) { quotaHit(); return json({error:'Family creation limit reached. Try later.'},429); }
        bump('create:'+ip,3600000);bump('global',86400000);
      } else {
        if((get('lookup:'+ip)?.count||0)>=30) { quotaHit(); return json({error:'Too many unknown family codes. Try in 15 minutes.'},429); }
        if(kind==='lookup-failed') bump('lookup:'+ip,900000);
      }
      return json({ok:true});
    });
  }
}
export default {
  scheduled(controller,env,ctx) {
    settingsFor(env);
    ctx.waitUntil(scheduledEmails(env,new Date(controller.scheduledTime)));
  },
  async fetch(request,env,ctx) {
    settingsFor(env);
    const url=new URL(request.url);
    const moved=legacyResponse(request,env);if(moved)return moved;
    const cleanHeaders=new Headers(request.headers);cleanHeaders.delete('X-Internal-Account-Parent');request=new Request(request,{headers:cleanHeaders});
    const auth=await routeAuth(request,env);if(auth)return auth;
    if(url.pathname==='/mcp' || url.pathname.startsWith('/mcp/t/')) {
      if(request.headers.has('Origin') && request.headers.get('Origin')!==url.origin) return json({error:'Cross-origin request denied'},403);
      if(request.method!=='POST')return json({error:'Method not allowed'},405,{Allow:'POST'});
      if(!env.SESSION_SECRET || env.SESSION_SECRET.length<32 || !env.IP_HASH_SALT || env.IP_HASH_SALT.length<32)return json({error:'Service secrets are not configured'},503);
      const ip=await sha256(env.IP_HASH_SALT+':'+(request.headers.get('CF-Connecting-IP')||'local'));
      const limited=await env.REGISTRY.get(env.REGISTRY.idFromName('registry')).fetch(new Request('https://internal/limit',{method:'POST',body:JSON.stringify({kind:'mcp',ip})}));
      if(!limited.ok)return limited;
      if(retiredToken(request))return json({error:RETIRED_LINK},401,{'WWW-Authenticate':'Bearer'});
      const token=routeToken(request);
      if(!token)return json({error:'Unauthorized'},401,{'WWW-Authenticate':'Bearer'});
      const familyHash=await decryptRoute(env.SESSION_SECRET,token[2]);
      if(!familyHash)return json({error:'Unauthorized'},401,{'WWW-Authenticate':'Bearer'});
      const headers=new Headers(request.headers);headers.delete('X-Family-Code');headers.delete('Cookie');headers.set('X-Internal-Family-Hash',familyHash);headers.set('X-Internal-Sharing-IP',ip);
      headers.set('Authorization','Bearer '+token[1]);
      const internal=new URL(request.url);internal.pathname='/mcp';internal.search='';
      return env.FAMILY.get(env.FAMILY.idFromName('fam:'+familyHash)).fetch(new Request(internal,new Request(request,{headers})));
    }
    if(!url.pathname.startsWith('/api/')) {
      const assetURL=new URL(request.url);
      if(url.pathname.startsWith('/f/') || /^\/[sc]\//.test(url.pathname) || ['/privacy','/privacy/'].includes(url.pathname)) assetURL.pathname='/';
      const response=await env.ASSETS.fetch(new Request(assetURL,request));
      const headers=new Headers(response.headers);
      headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
      if(/^\/[sc]\//.test(url.pathname)) {
        headers.set('X-Robots-Tag','noindex, nofollow');
        headers.set('Cache-Control','no-store');
        headers.delete('ETag');headers.delete('Content-Length');
        const shell=(await response.text()).replace('<head>','<head>\n    <meta name="robots" content="noindex" />');
        return new Response(shell,{status:response.status,headers});
      }
      if(url.pathname==='/sw.js') { headers.set('Cache-Control','no-cache, no-store, must-revalidate'); headers.set('Service-Worker-Allowed','/'); }
      return new Response(response.body,{status:response.status,headers});
    }
    if(url.pathname==='/api/ops/stats') {
      if(!env.OPS_TOKEN || request.method!=='GET') return json({error:'Route not found'},404);
      const supplied=request.headers.get('Authorization')||'';
      if(!await equalSecret(supplied,'Bearer '+env.OPS_TOKEN)) return json({error:'Unauthorized'},401);
      const response=await env.REGISTRY.get(env.REGISTRY.idFromName('registry')).fetch(new Request('https://internal/stats'));
      if(!response.ok)return response;
      const stats=await response.json();
      if(env.SHARES)stats.sharing=await shareRequest(env,'/stats',{});if(env.ACCOUNTS)stats.email=await accountRequest(env,'/stats');
      let service='unbound';if(env.ACCOUNTS_SVC)try{service=await accountsRpc(env,'getUser',{sub:'jl1_probe_nonexistent'})===null?'ok':'error';}catch{service='error';}stats.accounts={parents:stats.email?.parents||0,service};
      return json(stats);
    }
    if(!env.SESSION_SECRET || env.SESSION_SECRET.length<32 || !env.IP_HASH_SALT || env.IP_HASH_SALT.length<32) return json({error:'Service secrets are not configured'},503);
    if(['POST','PATCH','DELETE'].includes(request.method) && request.headers.get('Origin') && request.headers.get('Origin')!==url.origin) return json({error:'Cross-origin write denied'},403);
    if(url.pathname==='/api/config'&&!request.headers.has('X-Family-Code'))return json({serverTts:true,...authConfig(env,request)});
    const ip=await sha256(env.IP_HASH_SALT+':'+(request.headers.get('CF-Connecting-IP') || 'local'));
    const registry=env.REGISTRY.get(env.REGISTRY.idFromName('registry'));
    const limit=kind=>registry.fetch(new Request('https://internal/limit',{method:'POST',body:JSON.stringify({kind,ip})}));
    const publicShare=/^\/api\/(share|class|report)\/([^/]+)$/.exec(url.pathname);
    if(publicShare) {
      if(!validSlug(publicShare[2]))return json({error:'Shared content not found'},404,{'X-Robots-Tag':'noindex, nofollow'});
      if(request.method!==(publicShare[1]==='report'?'POST':'GET'))return json({error:'Method not allowed'},405);
      if(publicShare[1]==='report'&&!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))return json({error:'Send JSON'},415);
      const limited=await limit('sharing-read');if(!limited.ok)return limited;
      try {
        let report={};
        if(publicShare[1]==='report') {
          const reader=request.body?.getReader(),chunks=[];let length=0;
          if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>4096){await reader.cancel();return json({error:'Report too large'},413);}chunks.push(value);}}finally{reader.releaseLock();}
          const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
          const body=new TextDecoder().decode(bytes);
          try{report=JSON.parse(body);}catch{return json({error:'Invalid JSON'},400);}
          if(!report||typeof report!=='object'||Array.isArray(report)||report.reason!==undefined&&(typeof report.reason!=='string'||report.reason.length>300))return json({error:'Use a report reason of at most 300 characters'},400);
        }
        return json(await shareRequest(env,publicShare[1]==='report'?'/report':'/read',{slug:publicShare[2],ip,...(publicShare[1]==='report'?{reason:report.reason??''}:{kind:publicShare[1]})}),200,{'X-Robots-Tag':'noindex, nofollow'});
      }
      catch(e){return json({error:e.status?e.message:'Sharing unavailable'},e.status||503,{'X-Robots-Tag':'noindex, nofollow'});}
    }
    if(url.pathname==='/api/families' && request.method==='POST') {
      const limited=await limit('create');if(!limited.ok) return limited;
      const code=generateFamilyCode(), hash=await sha256(code);
      const headers=new Headers(request.headers);headers.set('X-Internal-Family-Hash',hash);headers.set('X-Family-Code',code);headers.set('X-Internal-Sharing-IP',ip);
      const internal=new URL(request.url);internal.pathname='/api/internal/create';
      const response=await env.FAMILY.get(env.FAMILY.idFromName('fam:'+hash)).fetch(new Request(internal,{method:'POST',headers,body:request.body,duplex:'half'}));
      if(!response.ok)return response;
      const account=await accountSession(request,env);let linkError;if(account)try{await linkFamily(env,account,code);}catch(e){linkError=e.status?e.message:'Sign-in linking unavailable';}
      return new Response(JSON.stringify({...await response.json(),code,...(linkError?{linkError}:{})}),{status:201,headers:response.headers});
    }
    // This endpoint is intentionally reachable only from the create branch above.
    if(url.pathname.startsWith('/api/internal/')) return json({error:'Route not found'},404);
    const limited=await limit('lookup-check');if(!limited.ok)return limited;
    const code=normalizeCode(request.headers.get('X-Family-Code'));
    if(!validCode(code)) {await limit('lookup-failed');return json({error:'Family not found'},404);}
    const hash=await sha256(code), headers=new Headers(request.headers);
    headers.set('X-Internal-Family-Hash',hash);headers.set('X-Family-Code',code);headers.set('X-Internal-Sharing-IP',ip);
    const account=await accountSession(request,env);if(account?.families.some(f=>f.hash===hash)){const r=await env.FAMILY.get(env.FAMILY.idFromName('fam:'+hash)).fetch(new Request('https://internal/api/internal/account/parents',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));if(r.ok&&(await r.json()).parents.some(p=>p.hash===account.hash))headers.set('X-Internal-Account-Parent','1');}
    const isTts=url.pathname==='/api/tts' && request.method==='GET';
    // Reuse the ordinary family lookup path; never trust a syntactically valid code alone.
    const lookupURL=new URL(request.url);if(isTts) lookupURL.pathname='/api/config';
    const response=await env.FAMILY.get(env.FAMILY.idFromName('fam:'+hash)).fetch(new Request(lookupURL,new Request(request,{headers})));
    if(isTts && response.ok) return tts(request,env,characters=>registry.fetch(new Request('https://internal/limit',{method:'POST',body:JSON.stringify({kind:'tts',ip,family:hash,characters})})),ctx,async(metric,count=1)=>{try{await registry.fetch(new Request('https://internal/voice',{method:'POST',body:JSON.stringify({metric,count})}));}catch{/* Best effort. */}});
    // Only a missing family counts, not missing resources in an existing space.
    if(response.status===404 && (await response.clone().json()).error==='Family not found') await limit('lookup-failed');
    if(url.pathname==='/api/parent/lock'&&response.ok){const h=new Headers(response.headers);h.append('Set-Cookie','fp_account=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');return new Response(response.body,{status:response.status,headers:h});}
    return response;
  }
};
