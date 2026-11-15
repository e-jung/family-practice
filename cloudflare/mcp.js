// Stateless Streamable HTTP: JSON responses only, no SDK, sessions, SSE or OAuth.
import {sha256} from './auth.js';
export const MCP_VERSION='2025-11-25';
const versions=[MCP_VERSION,'2025-06-18','2025-03-26'];
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
const error=(id,code,message,status=400)=>json({jsonrpc:'2.0',id,error:{code,message}},status);
const obj=properties=>({type:'object',properties,additionalProperties:false});
const id={type:'integer',minimum:1}, text=maxLength=>({type:'string',minLength:1,maxLength});
const kid={anyOf:[id,text(60)]};
const wordSet={type:'array',minItems:1,maxItems:100,items:{...obj({word:text(100),sentence:{type:'string',maxLength:500}}),required:['word']}};
const listFields={title:text(120),date:{type:'string',format:'date'},words:wordSet};
const schema=(properties,required=[])=>({...obj(properties),required});
export const MCP_TOOLS=[
 ['list_kids','List kids (id, first name or nickname, optional grade).',schema({})],
 ['list_spelling_lists','List a kid’s spelling lists with dates, word counts and archived status. Kid accepts an id or exact case-insensitive name.',schema({kid},['kid'])],
 ['get_spelling_list','Read a spelling list, including its words and example sentences.',schema({list_id:id},['list_id'])],
 ['add_spelling_list','Create a new weekly list for a kid (id or exact case-insensitive name). Supply kid-friendly example sentences; missing sentences stay blank. Add a new list for new weekly words.',schema({kid,...listFields},['kid','words'])],
 ['update_spelling_list','Update a list’s title/date or replace its word set while preserving practice history. Supply kid-friendly sentences; missing sentences stay blank.',schema({list_id:id,...listFields},['list_id'])],
 ['add_verse',"Add a verse for a kid (id or exact case-insensitive name). Paste the family's own translation text; do not fabricate scripture. Public-domain KJV/WEB is fine.",schema({kid,reference:text(120),text:text(2000),translation:{type:'string',maxLength:60},due_date:{type:'string',format:'date'}},['kid','reference','text'])],
 ['get_shared_list','Read an unlisted spelling snapshot or published class week. Only public content is returned.',schema({url_or_slug:text(2048),week_id:text(36)},['url_or_slug'])],
 ['import_shared_list','Copy an unlisted snapshot or class week into selected kids’ editable practice lists.',schema({url_or_slug:text(2048),kids:{type:'array',minItems:1,maxItems:10,items:id},include_verse:{type:'boolean'},week_id:text(36)},['url_or_slug','kids'])],
 ['get_progress','Read aggregates only: first-try accuracy per list, Learning/Getting it/Mastered counts, struggling words, due-today count and verse stars. Kid accepts id or exact case-insensitive name.',schema({kid},['kid'])],
].map(([name,description,inputSchema])=>({name,description,inputSchema,annotations:{readOnlyHint:!['add_spelling_list','update_spelling_list','add_verse','import_shared_list'].includes(name),destructiveHint:false,openWorldHint:false}}));
const writable=name=>['add_spelling_list','update_spelling_list','add_verse','import_shared_list'].includes(name);
function valid(value,s) {
 if(s.anyOf)return s.anyOf.some(option=>valid(value,option));
 if(s.type==='object')return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>Object.hasOwn(s.properties,k)&&valid(value[k],s.properties[k]))&&(s.required||[]).every(k=>Object.hasOwn(value,k));
 if(s.type==='boolean')return typeof value==='boolean';
 if(s.type==='integer')return Number.isSafeInteger(value)&&value>=s.minimum;
 if(s.type==='array')return Array.isArray(value)&&value.length>=s.minItems&&value.length<=s.maxItems&&value.every(v=>valid(v,s.items));
 if(s.type==='string')return typeof value==='string'&&value.length<=(s.maxLength??Infinity)&&value.trim().length>=(s.minLength??0)&&(!s.format||(/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value));
 return false;
}
const enc=new TextEncoder();
export const RETIRED_LINK='This connection link format was retired; create a new connection in Parent → Connect an AI assistant';
async function routeKey(secret) {
 if(typeof secret!=='string'||secret.length<32)throw Error('Service secrets are not configured');
 const material=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const derived=await crypto.subtle.sign('HMAC',material,enc.encode('mcp-route-v2'));
 return crypto.subtle.importKey('raw',derived,'AES-GCM',false,['encrypt','decrypt']);
}
export async function encryptRoute(secret,familyHash) {
 if(!/^[a-f0-9]{64}$/.test(familyHash))throw Error('Invalid family route');
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await routeKey(secret),enc.encode(familyHash)));
 return btoa(String.fromCharCode(...iv,...encrypted)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
export async function decryptRoute(secret,route) {
 try {
  if(!/^[A-Za-z0-9_-]{123}$/.test(route))return null;
  const bytes=Uint8Array.from(atob(route.replaceAll('-','+').replaceAll('_','/')+'='),c=>c.charCodeAt(0));
  if(btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')!==route)return null;
  const hash=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},await routeKey(secret),bytes.slice(12)));
  return /^[a-f0-9]{64}$/.test(hash)?hash:null;
 }catch{return null;}
}
export function retiredToken(request) {
 const link=new URL(request.url).pathname.startsWith('/mcp/t/')?new URL(request.url).pathname.slice(7):null;
 return /^fp_[a-f0-9]{64}_[a-f0-9]{64}$/.test(link??(request.headers.get('Authorization')||'').replace(/^Bearer /,''));
}
export function initConnections(sql) {
 sql.exec('CREATE TABLE IF NOT EXISTS mcp_connections(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,name TEXT NOT NULL,scope TEXT NOT NULL,created_at TEXT NOT NULL,last_used_at TEXT); CREATE TABLE IF NOT EXISTS mcp_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL)');
 if(![...sql.exec('PRAGMA table_info(mcp_connections)')].some(c=>c.name==='format'))sql.exec("ALTER TABLE mcp_connections ADD COLUMN format TEXT NOT NULL DEFAULT 'retired'");
}
export const connectionFields='id,name,scope,created_at,last_used_at,format';
export async function createConnection(sql,familyHash,b,secret) {
 if(!b||Object.keys(b).some(k=>!['name','scope'].includes(k))||typeof b.name!=='string'||!b.name.trim()||b.name.length>80||!['add-read','read-only'].includes(b.scope??'add-read'))throw Object.assign(Error('Use a name (1–80 characters) and add-read or read-only scope'),{status:400});
 if([...sql.exec('SELECT COUNT(*) n FROM mcp_connections')][0].n>=5)throw Object.assign(Error('Maximum 5 connections; revoke one first'),{status:400});
 const random=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const token=`fpc2_${await encryptRoute(secret,familyHash)}_${random}`,connection={id:crypto.randomUUID(),name:b.name.trim(),scope:b.scope??'add-read',created_at:new Date().toISOString(),last_used_at:null,format:'fpc2'};
 sql.exec('INSERT INTO mcp_connections(id,token_hash,name,scope,created_at,last_used_at,format) VALUES(?,?,?,?,?,?,?)',connection.id,await sha256(token),connection.name,connection.scope,connection.created_at,null,connection.format);
 return {connection,token};
}
export function routeToken(request) {
 const path=new URL(request.url).pathname;
 const link=path.startsWith('/mcp/t/')?path.slice(7):null;
 const authorization=request.headers.get('Authorization');
 // Never let a conflicting header silently switch a connection URL's identity.
 if(link!==null && authorization && authorization!=='Bearer '+link)return null;
 return /^Bearer (fpc2_([A-Za-z0-9_-]{123})_[a-f0-9]{64})$/.exec(link===null?authorization||'':'Bearer '+link);
}
export async function handleMcp(request,sql,run) {
 const url=new URL(request.url);
 if(request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'Cross-origin request denied'},403);
 if(request.method!=='POST')return json({error:'Method not allowed'},405,{Allow:'POST'});
 if(retiredToken(request))return json({error:RETIRED_LINK},401);
 const token=routeToken(request);
 const connection=token&&[...sql.exec('SELECT * FROM mcp_connections WHERE token_hash=?',await sha256(token[1]))][0];
 if(!connection)return json({error:'Unauthorized'},401,{'WWW-Authenticate':'Bearer'});
 const now=Date.now();sql.exec('DELETE FROM mcp_limits WHERE until<=?',now);
 const reserve=(key,max,ms)=>{const row=[...sql.exec('SELECT * FROM mcp_limits WHERE key=?',key)][0];if(row?.count>=max)return false;sql.exec('INSERT INTO mcp_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',key,now+ms);return true;};
 if(!reserve('token:'+connection.id,60,60000))return json({error:'Rate limited'},429,{'Retry-After':'60'});
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))return json({error:'Send JSON'},415);
 const accept=request.headers.get('Accept')||'';
 if(accept&&!accept.split(',').some(v=>['application/json','*/*','application/*'].includes(v.trim().split(';')[0])))return json({error:'Accept application/json'},406);
 const reader=request.body?.getReader();let size=0,chunks=[];
 if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>256*1024){await reader.cancel();return json({error:'Body too large'},413);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let call;try{call=JSON.parse(new TextDecoder().decode(bytes));}catch{return error(null,-32700,'Parse error');}
 if(!call||typeof call!=='object'||Array.isArray(call)||call.jsonrpc!=='2.0'||typeof call.method!=='string'||(Object.hasOwn(call,'id')&&!(call.id===null||typeof call.id==='string'||typeof call.id==='number'&&Number.isFinite(call.id)))||(call.params!==undefined&&(!call.params||typeof call.params!=='object'||Array.isArray(call.params))))return error(null,-32600,'Invalid request; batches are not supported');
 const version=request.headers.get('MCP-Protocol-Version');
 if(version&&!versions.includes(version))return error(call.id??null,-32600,'Unsupported MCP protocol version');
 sql.exec('UPDATE mcp_connections SET last_used_at=? WHERE id=?',new Date(now).toISOString(),connection.id);
 if(!Object.hasOwn(call,'id'))return new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});
 const ok=result=>json({jsonrpc:'2.0',id:call.id,result});
 if(call.method==='initialize') {
  if(typeof call.params?.protocolVersion!=='string'||!call.params.capabilities||typeof call.params.capabilities!=='object'||Array.isArray(call.params.capabilities)||!call.params.clientInfo||typeof call.params.clientInfo.name!=='string'||typeof call.params.clientInfo.version!=='string')return error(call.id,-32602,'Invalid initialize parameters');
  return ok({protocolVersion:versions.includes(call.params.protocolVersion)?call.params.protocolVersion:MCP_VERSION,capabilities:{tools:{listChanged:false}},serverInfo:{name:'Spellami',version:'1.0.0'},instructions:'Family-scoped parent-managed practice. Supply verse wording yourself. No deletion or account tools.'});
 }
 if(call.method==='ping')return ok({});
 if(call.method==='tools/list')return ok({tools:MCP_TOOLS.filter(t=>connection.scope==='add-read'||!writable(t.name))});
 if(call.method!=='tools/call')return error(call.id,-32601,'Method not found',200);
 const tool=MCP_TOOLS.find(t=>t.name===call.params?.name),args=call.params?.arguments??{};
 if(!tool||!valid(args,tool.inputSchema))return error(call.id,-32602,'Unknown tool or invalid arguments',200);
 const toolError=message=>ok({isError:true,content:[{type:'text',text:message}]});
 if(writable(tool.name)&&connection.scope!=='add-read')return toolError('This connection is read-only');
 if(writable(tool.name)&&!reserve('writes',20,3600000))return json({error:'Family write limit reached'},429,{'Retry-After':'3600'});
 try {const result=await run(tool.name,args);return ok({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result});}
 catch(e){return toolError(e.status?e.message:'Unable to complete tool call');}
}
