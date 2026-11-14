import {sha256,CODE_WORDS} from './auth.js';
// Unlisted snapshots: the public store never receives a family code, child, or practice history.
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}});
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
// Three pronounceable kid-safe compounds plus four base32 characters. Each
// compound combines TWO independent 11-bit curated choices: 86 random bits total.
export const validSlug=value=>typeof value==='string'&&/^[a-z]{10,48}-[a-z]{10,48}-[a-z]{10,48}-[a-z2-7]{4}$/.test(value);
export function generateShareSlug(){const r=crypto.getRandomValues(new Uint32Array(10));return [0,2,4].map(i=>CODE_WORDS[r[i]&2047]+CODE_WORDS[r[i+1]&2047]).join('-')+'-'+[6,7,8,9].map(i=>'abcdefghijklmnopqrstuvwxyz234567'[r[i]&31]).join('');}
export function sharedSlug(input){if(validSlug(input))return input;if(typeof input==='string'&&input.length<=2048){try{const url=new URL(input);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password){const match=/^\/[sc]\/([^/]+)\/?$/.exec(url.pathname);if(match&&validSlug(match[1]))return match[1];}}catch{}}fail('Invalid shared link');}

const text=(v,max,optional=false)=>{if(typeof v!=='string'||v.length>max||!optional&&!v.trim())fail('Invalid shared content');return v.trim();};
const day=v=>{if(v===''||v===undefined)return '';if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('Invalid date');return v;};
export function safeSnapshot(b) {
 if(!b||!Array.isArray(b.words)||b.words.length<1||b.words.length>100)fail('Use 1–100 words');
 const result={title:text(b.title,120),date:day(b.date),note:text(b.note??'',140,true),words:b.words.map(w=>({word:text(w?.word,100),sentence:text(w?.sentence??'',500,true)}))};
 if(b.verse)result.verse={reference:text(b.verse.reference,120),text:text(b.verse.text,2000),translation:text(b.verse.translation??'',60,true)};
 return result;
}
export async function ownerHash(secret,familyHash) {
 if(typeof secret!=='string'||secret.length<32||!/^[a-f0-9]{64}$/.test(familyHash||''))fail('Sharing is not configured',503);
 const encoder=new TextEncoder(),key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode('sharing-owner:'+familyHash)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function shareRequest(env,path,body) {
 if(!env.SHARES)fail('Sharing is not configured',503);
 const response=await env.SHARES.get(env.SHARES.idFromName('shares')).fetch(new Request('https://internal'+path,{method:'POST',body:JSON.stringify(body)}));
 const data=await response.json();if(!response.ok)fail(data.error||'Shared content unavailable',response.status);return data;
}
export class ShareStore {
 constructor(ctx) {
  this.ctx=ctx;this.sql=ctx.storage.sql;
  this.sql.exec(`CREATE TABLE IF NOT EXISTS shared_items(slug TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,name TEXT NOT NULL,snapshot TEXT,created_at TEXT NOT NULL,stopped INTEGER NOT NULL DEFAULT 0,imports INTEGER NOT NULL DEFAULT 0,reports INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX IF NOT EXISTS shared_owner ON shared_items(owner);
   CREATE TABLE IF NOT EXISTS shared_weeks(id TEXT PRIMARY KEY,slug TEXT NOT NULL,snapshot TEXT NOT NULL,published_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS shared_weeks_slug ON shared_weeks(slug,published_at);
   CREATE TABLE IF NOT EXISTS shared_followers(slug TEXT NOT NULL,owner TEXT NOT NULL,PRIMARY KEY(slug,owner));
   CREATE TABLE IF NOT EXISTS shared_reports(slug TEXT NOT NULL,ip TEXT NOT NULL,day TEXT NOT NULL,PRIMARY KEY(slug,ip,day));`);
 }
 fetch(request) {return this.ctx.blockConcurrencyWhile(async()=>{try {
  const p=new URL(request.url).pathname,b=await request.json(),all=(q,...args)=>[...this.sql.exec(q,...args)],get=(q,...args)=>all(q,...args)[0];
  const owner=()=>{if(!/^[a-f0-9]{64}$/.test(b.owner||''))fail('Invalid owner');return b.owner;};
  const fields=r=>{const out={slug:r.slug,kind:r.kind,created_at:r.created_at,stopped:!!r.stopped,imports:r.imports,reports:r.reports};if(r.kind==='share')Object.assign(out,JSON.parse(r.snapshot));else Object.assign(out,{name:r.name,week_count:get('SELECT COUNT(*) n FROM shared_weeks WHERE slug=?',r.slug).n,followers:get('SELECT COUNT(*) n FROM shared_followers WHERE slug=?',r.slug).n});return out;};
  const weekFields=w=>({...JSON.parse(w.snapshot),week_id:w.id,published_at:w.published_at});
  const latest=slug=>{const w=get('SELECT * FROM shared_weeks WHERE slug=? ORDER BY published_at DESC,rowid DESC LIMIT 1',slug);return w?weekFields(w):null;};
  const weeks=slug=>all('SELECT * FROM shared_weeks WHERE slug=? ORDER BY published_at DESC,rowid DESC',slug).map(weekFields);
  if(p==='/create') {
   const o=owner();if(!['share','class'].includes(b.kind))fail('Invalid kind');
   if(get('SELECT COUNT(*) n FROM shared_items WHERE owner=? AND stopped=0',o).n>=200)fail('Maximum 200 active shared links');
   if(b.kind==='class'&&get("SELECT COUNT(*) n FROM shared_items WHERE owner=? AND kind='class' AND stopped=0",o).n>=5)fail('Maximum 5 active class lists');
   const slug=generateShareSlug(),created=new Date().toISOString(),snapshot=b.kind==='share'?safeSnapshot(b.snapshot):null,name=b.kind==='class'?text(b.name,80):'';
   this.sql.exec('INSERT INTO shared_items(slug,owner,kind,name,snapshot,created_at) VALUES(?,?,?,?,?,?)',slug,o,b.kind,name,snapshot?JSON.stringify(snapshot):null,created);
   return json({[b.kind]:fields(get('SELECT * FROM shared_items WHERE slug=?',slug)),url:(b.kind==='share'?'/s/':'/c/')+slug},201);
  }
  if(p==='/list')return json({[b.kind==='class'?'classes':'shares']:all('SELECT * FROM shared_items WHERE owner=? AND kind=? ORDER BY created_at DESC,rowid DESC',owner(),b.kind).map(r=>({...fields(r),...(r.kind==='class'?{latest:latest(r.slug)}:{})}))});
  if(p==='/stop-all'){this.sql.exec('UPDATE shared_items SET stopped=1 WHERE owner=?',owner());this.sql.exec('DELETE FROM shared_followers WHERE owner=?',b.owner);return json({ok:true});}
  if(p==='/latest') {
   if(!Array.isArray(b.slugs)||b.slugs.length>50||b.slugs.some(slug=>!validSlug(slug)))fail('Invalid classes');
   return json({classes:b.slugs.map(slug=>{const r=get("SELECT * FROM shared_items WHERE slug=? AND kind='class'",slug);if(!r||r.stopped)return {slug,available:false,latest:null};return {slug,available:true,name:r.name,latest:latest(slug)};})});
  }
  if(!validSlug(b.slug))fail('Shared content not found',404);
  const row=get('SELECT * FROM shared_items WHERE slug=?',b.slug);if(!row)fail('Shared content not found',404);
  if(['/stop','/rename','/publish'].includes(p)) {
   if(row.owner!==owner()||b.kind&&b.kind!==row.kind)fail('Shared content not found',404);
   if(p==='/stop'){this.sql.exec('UPDATE shared_items SET stopped=1 WHERE slug=?',b.slug);return json({ok:true});}
   if(row.stopped)fail('This list is no longer shared',410);
   if(row.kind!=='class')fail('Class not found',404);
   if(p==='/rename'){this.sql.exec('UPDATE shared_items SET name=? WHERE slug=?',text(b.name,80),b.slug);return json({class:fields(get('SELECT * FROM shared_items WHERE slug=?',b.slug))});}
   const previous=get('SELECT published_at FROM shared_weeks WHERE slug=? ORDER BY published_at DESC,rowid DESC LIMIT 1',b.slug);
   if(previous&&Date.now()-Date.parse(previous.published_at)<600000)fail('Wait 10 minutes between published weeks',429);
   const snapshot=safeSnapshot(b.snapshot),week_id=crypto.randomUUID(),published_at=new Date().toISOString();
   this.sql.exec('INSERT INTO shared_weeks VALUES(?,?,?,?)',week_id,b.slug,JSON.stringify(snapshot),published_at);
   this.sql.exec('DELETE FROM shared_weeks WHERE slug=? AND id NOT IN (SELECT id FROM shared_weeks WHERE slug=? ORDER BY published_at DESC,rowid DESC LIMIT 200)',b.slug,b.slug);
   return json({class:fields(row),week:{...snapshot,week_id,published_at}},201);
  }
  if(p==='/follow'&&b.enabled===false){this.sql.exec('DELETE FROM shared_followers WHERE slug=? AND owner=?',b.slug,owner());return json({ok:true});}
  if(row.stopped)fail('This list is no longer shared',410);
  if(p==='/read') {
   if(b.kind&&b.kind!==row.kind)fail('Shared content not found',404);
   if(row.kind==='share')return json({share:fields(row)});
   const ws=weeks(b.slug);return json({class:fields(row),weeks:ws,latest:ws[0]??null});
  }
  if(p==='/report') {
   if(!/^[a-f0-9]{64}$/.test(b.ip||''))fail('Invalid report');
   const today=new Date().toISOString().slice(0,10);this.sql.exec('DELETE FROM shared_reports WHERE day<?',new Date(Date.now()-86400000).toISOString().slice(0,10));
   if(!get('SELECT slug FROM shared_reports WHERE slug=? AND ip=? AND day=?',b.slug,b.ip,today)){this.sql.exec('INSERT INTO shared_reports VALUES(?,?,?)',b.slug,b.ip,today);this.sql.exec('UPDATE shared_items SET reports=reports+1 WHERE slug=?',b.slug);}
   return json({ok:true});
  }
  if(p==='/import'){owner();this.sql.exec('UPDATE shared_items SET imports=imports+1 WHERE slug=?',b.slug);return json({ok:true});}
  if(p==='/follow'){owner();if(row.kind!=='class')fail('Only classes can be followed');this.sql.exec('INSERT OR IGNORE INTO shared_followers VALUES(?,?)',b.slug,b.owner);return json({ok:true});}
  fail('Route not found',404);
 }catch(e){return json({error:e.status?e.message:'Sharing unavailable'},e.status||500);}});}
}

// All child-specific data stays in this family-local controller.
export function createSharing(ctx,env,{all,get,addList,addVerse,tx}) {
 const sql=ctx.storage.sql;
 sql.exec(`CREATE TABLE IF NOT EXISTS class_follows(slug TEXT PRIMARY KEY,kids TEXT NOT NULL,include_verse INTEGER NOT NULL,last_imported TEXT NOT NULL DEFAULT '{}',cached TEXT,checked_at INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS shared_imports(slug TEXT NOT NULL,week_id TEXT NOT NULL,kid_id INTEGER NOT NULL,list_id INTEGER NOT NULL,PRIMARY KEY(slug,week_id,kid_id));`);
 for(const table of ['lists','verses'])for(const column of ['source_slug','source_week_id','source_kind','source_note','source_class_name'])if(!all('PRAGMA table_info('+table+')').some(c=>c.name===column))sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
 const owner=()=>ownerHash(env.SESSION_SECRET,env.familyIdHash);
 const call=async(path,b={})=>shareRequest(env,path,{...b,owner:await owner()});
 const reserve=async kind=>{
  if(!env.SHARES)fail('Sharing is not configured',503);
  const ip=env.sharingIpHash||await sha256((env.IP_HASH_SALT||'')+':local');
  const response=await env.REGISTRY.get(env.REGISTRY.idFromName('registry')).fetch(new Request('https://internal/limit',{method:'POST',body:JSON.stringify({kind,ip,family:await owner()})}));
  if(!response.ok)fail((await response.json()).error,response.status);
 };
 const kids=b=>{if(!Array.isArray(b)||!b.length||b.length>10||b.some(k=>!Number.isSafeInteger(k)||!get('SELECT id FROM kids WHERE id=? AND archived=0',k)))fail('Choose 1–10 active kids');return [...new Set(b)];};
 const include=v=>{if(v!==undefined&&typeof v!=='boolean')fail('include_verse must be a boolean');return v===true;};
 function snapshot(b) {
  if(!Number.isSafeInteger(b.list_id)||b.list_id<1)fail('Invalid list ID');
  const l=get('SELECT l.* FROM lists l JOIN kids k ON k.id=l.kid_id WHERE l.id=? AND l.archived=0 AND k.archived=0',b.list_id??0);if(!l)fail('List not found',404);
  let verse;if(b.verse_id!==undefined&&b.verse_id!==null&&b.verse_id!==''){if(!Number.isSafeInteger(b.verse_id)||b.verse_id<1)fail('Invalid verse ID');verse=get('SELECT v.* FROM verses v JOIN kids k ON k.id=v.kid_id WHERE v.id=? AND v.kid_id=? AND v.archived=0 AND k.archived=0',b.verse_id,l.kid_id);if(!verse)fail('Verse not found',404);}
  return safeSnapshot({...l,note:b.note??'',words:all('SELECT word,sentence FROM words WHERE list_id=? AND archived=0 ORDER BY id',l.id),verse});
 }
 async function read(slug,week_id) {
  slug=sharedSlug(slug);
  await reserve('sharing-read');
  const result=await call('/read',{slug});
  if(result.share){if(week_id)fail('Week not found',404);return {snapshot:result.share,week_id:'',kind:'share',slug};}
  const week=week_id?result.weeks.find(w=>w.week_id===week_id):result.latest;if(!week)fail('No published week found',404);
  return {snapshot:week,week_id:week.week_id,kind:'class',class:result.class,slug};
 }
 async function importShared(b) {
  const selected=kids(b.kids),withVerse=include(b.include_verse);await reserve('sharing-import');const data=await read(b.url_or_slug??b.slug,b.week_id),snapshot=safeSnapshot(data.snapshot),key=data.week_id;
  const result={lists:[],verses:[],skipped_verses:[],week_id:key};
  // A synchronous transaction makes a multi-kid import all-or-nothing, including family limits.
  tx(()=>{
   const source=[data.slug,key,data.kind,snapshot.note,data.class?.name??''];
   for(const kid of selected) {
    const list_id=addList({...snapshot,kid_id:kid});
    sql.exec('UPDATE lists SET source_slug=?,source_week_id=?,source_kind=?,source_note=?,source_class_name=? WHERE id=?',...source,list_id);
    sql.exec('INSERT INTO shared_imports VALUES(?,?,?,?) ON CONFLICT(slug,week_id,kid_id) DO UPDATE SET list_id=excluded.list_id',data.slug,key,kid,list_id);
    result.lists.push({kid_id:kid,list_id});
    if(withVerse&&snapshot.verse){const v=snapshot.verse;const duplicate=get('SELECT id FROM verses WHERE kid_id=? AND reference=? AND text=? AND archived=0',kid,v.reference,v.text);if(duplicate)result.skipped_verses.push(kid);else {const verse_id=addVerse({...v,kid_id:kid});sql.exec('UPDATE verses SET source_slug=?,source_week_id=?,source_kind=?,source_note=?,source_class_name=? WHERE id=?',...source,verse_id);result.verses.push({kid_id:kid,verse_id});}}
   }
   const follow=get('SELECT * FROM class_follows WHERE slug=?',data.slug);if(follow){const last=JSON.parse(follow.last_imported);for(const kid of selected)last[kid]=key;sql.exec('UPDATE class_follows SET last_imported=? WHERE slug=?',JSON.stringify(last),data.slug);}
  });
  try{await call('/import',{slug:data.slug});}catch{/* Aggregate reporting must not invalidate successful copies. */}
  return result;
 }
 async function follows(force=false) {
  const rows=all('SELECT * FROM class_follows ORDER BY rowid'),due=rows.filter(f=>force||Date.now()-f.checked_at>=600000);
  if(due.length){try{await reserve('sharing-read');const batch=await call('/latest',{slugs:due.map(f=>f.slug)});for(const item of batch.classes){const old=due.find(f=>f.slug===item.slug);const cached=old.cached?JSON.parse(old.cached):{};const cache={available:item.available,latest:item.latest,name:item.name??cached.name??''};sql.exec('UPDATE class_follows SET cached=?,checked_at=? WHERE slug=?',JSON.stringify(cache),Date.now(),item.slug);old.cached=JSON.stringify(cache);old.checked_at=Date.now();}}catch(e){if(!due.every(f=>f.cached))throw e;/* Retain previously checked snapshots on transient outages. */}}
  return {follows:rows.map(f=>({slug:f.slug,kids:JSON.parse(f.kids),include_verse:!!f.include_verse,last_imported:JSON.parse(f.last_imported),...(f.cached?JSON.parse(f.cached):{available:false,latest:null,name:''}),checked_at:f.checked_at}))};
 }
 async function route(p,method,b={},parent=false,refresh=false) {
  if(p==='/api/follows'&&method==='GET')return follows(parent&&refresh);
  if(p==='/api/admin/import-shared'&&method==='POST')return importShared(b);
  if(p==='/api/admin/shares'||p==='/api/admin/classes') {
   const kind=p.endsWith('classes')?'class':'share';
   if(method==='GET')return call('/list',{kind});
   if(method==='POST'){const content=kind==='share'?{snapshot:snapshot(b)}:{name:text(b.name,80)};await reserve('sharing-create');return call('/create',{kind,...content});}
  }
  const item=/^\/api\/admin\/(shares|classes)\/([^/]+)\/(stop|rename|publish)$/.exec(p);
  if(item&&method==='POST'){const result=await call('/'+item[3],{slug:item[2],kind:item[1]==='classes'?'class':'share',...(item[3]==='publish'?{snapshot:snapshot(b)}:item[3]==='rename'?{name:b.name}:{})});if(item[3]==='publish')sql.exec('UPDATE class_follows SET checked_at=0 WHERE slug=?',item[2]);return result;}
  const follow=/^\/api\/admin\/follows(?:\/([^/]+))?$/.exec(p);
  if(follow){const slug=follow[1]??b.slug;if(!validSlug(slug))fail('Invalid class link');const old=get('SELECT * FROM class_follows WHERE slug=?',slug);
   if(method==='DELETE'&&follow[1]){if(old){await call('/follow',{slug,enabled:false});sql.exec('DELETE FROM class_follows WHERE slug=?',slug);}return {ok:true};}
   if(method==='POST'&&!follow[1]||method==='PATCH'&&follow[1]){
    if(method==='PATCH'&&!old)fail('Follow not found',404);
    if(!old&&get('SELECT COUNT(*) n FROM class_follows').n>=50)fail('Maximum 50 followed classes');
    const selected=kids(b.kids??(old?JSON.parse(old.kids):null)),withVerse=include(b.include_verse??(old?!!old.include_verse:false));
    const data=await call('/read',{slug,kind:'class'});await call('/follow',{slug,enabled:true});
    sql.exec('INSERT INTO class_follows(slug,kids,include_verse,cached,checked_at) VALUES(?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET kids=excluded.kids,include_verse=excluded.include_verse,cached=excluded.cached,checked_at=excluded.checked_at',slug,JSON.stringify(selected),+withVerse,JSON.stringify({available:true,name:data.class.name,latest:data.latest}),Date.now());
    if(!old){const last={};for(const imported of all('SELECT kid_id,week_id FROM shared_imports WHERE slug=? ORDER BY rowid',slug))last[imported.kid_id]=imported.week_id;sql.exec('UPDATE class_follows SET last_imported=? WHERE slug=?',JSON.stringify(last),slug);}
    return {follow:(await follows()).follows.find(f=>f.slug===slug)};
   }
  }
  return undefined;
 }
 return {route,read,importShared,stopAll:()=>call('/stop-all')};
}
