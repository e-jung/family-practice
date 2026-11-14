import {shareRequest,validSlug} from './sharing.js';
export {ShareStore} from './sharing.js';
import {routeToken} from './mcp.js';
import { tts } from './tts.js';
export { TtsCache } from './tts.js';
import { createHandler } from './core.js';
import {sha256,generateFamilyCode,normalizeCode,validCode,equalSecret} from './auth.js';
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}});
export class FamilyDatabase {
  constructor(ctx,env) { this.ctx=ctx;this.env={...env};this.handler=createHandler(ctx,this.env); }
  fetch(request) {
    return this.ctx.blockConcurrencyWhile(async()=> {
      this.env.familyIdHash=request.headers.get('X-Internal-Family-Hash');
      this.env.familyCode=request.headers.get('X-Family-Code');
      this.env.sharingIpHash=request.headers.get('X-Internal-Sharing-IP');
      const response=await this.handler(request);
      const sql=this.ctx.storage.sql, day=new Date().toISOString().slice(0,10);
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
  constructor(ctx) {
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
        if(!/^[a-f0-9]{64}$/.test(family) || !Number.isInteger(characters) || characters<1 || characters>300) return json({error:'Invalid limit'},400);
        const day=new Date(now).toISOString().slice(0,10), until=Date.parse(day+'T00:00:00Z')+86400000;
        const globalKey='tts:global:'+day+':chars', familyKey='tts:family:'+family+':'+day+':chars', ipKey='tts:ip:'+ip+':chars';
        if((get(globalKey)?.count||0)+characters>6000 || (get(familyKey)?.count||0)+characters>1500 || (get(ipKey)?.count||0)+characters>2000) return json({error:'voice_quota'},429);
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
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    if(url.pathname==='/mcp' || url.pathname.startsWith('/mcp/t/')) {
      if(request.headers.has('Origin') && request.headers.get('Origin')!==url.origin) return json({error:'Cross-origin request denied'},403);
      if(request.method!=='POST')return json({error:'Method not allowed'},405,{Allow:'POST'});
      if(!env.IP_HASH_SALT || env.IP_HASH_SALT.length<32)return json({error:'Service secrets are not configured'},503);
      const ip=await sha256(env.IP_HASH_SALT+':'+(request.headers.get('CF-Connecting-IP')||'local'));
      const limited=await env.REGISTRY.get(env.REGISTRY.idFromName('registry')).fetch(new Request('https://internal/limit',{method:'POST',body:JSON.stringify({kind:'mcp',ip})}));
      if(!limited.ok)return limited;
      const token=routeToken(request);
      if(!token)return json({error:'Unauthorized'},401,{'WWW-Authenticate':'Bearer'});
      const headers=new Headers(request.headers);headers.delete('X-Family-Code');headers.delete('Cookie');headers.set('X-Internal-Family-Hash',token[2]);headers.set('X-Internal-Sharing-IP',ip);
      headers.set('Authorization','Bearer '+token[1]);
      const internal=new URL(request.url);internal.pathname='/mcp';internal.search='';
      return env.FAMILY.get(env.FAMILY.idFromName('fam:'+token[2])).fetch(new Request(internal,new Request(request,{headers})));
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
      if(!env.SHARES || !response.ok)return response;
      const stats=await response.json();
      stats.sharing=await shareRequest(env,'/stats',{});
      return json(stats);
    }
    if(!env.SESSION_SECRET || env.SESSION_SECRET.length<32 || !env.IP_HASH_SALT || env.IP_HASH_SALT.length<32) return json({error:'Service secrets are not configured'},503);
    if(['POST','PATCH','DELETE'].includes(request.method) && request.headers.get('Origin') && request.headers.get('Origin')!==url.origin) return json({error:'Cross-origin write denied'},403);
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
      return new Response(JSON.stringify({...await response.json(),code}),{status:201,headers:response.headers});
    }
    // This endpoint is intentionally reachable only from the create branch above.
    if(url.pathname.startsWith('/api/internal/')) return json({error:'Route not found'},404);
    const limited=await limit('lookup-check');if(!limited.ok)return limited;
    const code=normalizeCode(request.headers.get('X-Family-Code'));
    if(!validCode(code)) {await limit('lookup-failed');return json({error:'Family not found'},404);}
    const hash=await sha256(code), headers=new Headers(request.headers);
    headers.set('X-Internal-Family-Hash',hash);headers.set('X-Family-Code',code);headers.set('X-Internal-Sharing-IP',ip);
    const isTts=url.pathname==='/api/tts' && request.method==='GET';
    // Reuse the ordinary family lookup path; never trust a syntactically valid code alone.
    const lookupURL=new URL(request.url);if(isTts) lookupURL.pathname='/api/config';
    const response=await env.FAMILY.get(env.FAMILY.idFromName('fam:'+hash)).fetch(new Request(lookupURL,new Request(request,{headers})));
    if(isTts && response.ok) return tts(request,env,characters=>registry.fetch(new Request('https://internal/limit',{method:'POST',body:JSON.stringify({kind:'tts',ip,family:hash,characters})})),ctx,async(metric,count=1)=>{try{await registry.fetch(new Request('https://internal/voice',{method:'POST',body:JSON.stringify({metric,count})}));}catch{/* Best effort. */}});
    // Only a missing family counts, not missing resources in an existing space.
    if(response.status===404 && (await response.clone().json()).error==='Family not found') await limit('lookup-failed');
    return response;
  }
};
