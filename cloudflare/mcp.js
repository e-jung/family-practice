// Stateless Streamable HTTP: JSON responses only, no SDK, sessions, SSE or OAuth.
import {sha256} from './auth.js';
export const MCP_VERSION='2025-11-25';
const versions=[MCP_VERSION,'2025-06-18','2025-03-26'];
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
const error=(id,code,message,status=400)=>json({jsonrpc:'2.0',id,error:{code,message}},status);
const obj=properties=>({type:'object',properties,additionalProperties:false});
const id={type:'integer',minimum:1}, text=maxLength=>({type:'string',minLength:1,maxLength});
const listFields={kid_id:id,title:text(120),date:{type:'string',format:'date'},words:{type:'array',minItems:1,maxItems:100,items:{...obj({word:text(100),sentence:{type:'string',maxLength:500}}),required:['word']}}};
const schema=(properties,required=[])=>({...obj(properties),required});
export const MCP_TOOLS=[
 ['list_kids','List active kids (first names or nicknames only).',schema({})],
 ['list_spelling_lists','List active spelling lists for a kid, without word content.',schema({kid_id:id},['kid_id'])],
 ['get_spelling_list','Read an active spelling list and its words.',schema({id},['id'])],
 ['add_spelling_list','Add a parent-provided spelling list with optional example sentences.',schema(listFields,['kid_id','title','words'])],
 ['update_spelling_list','Replace the title, date and words of an active spelling list. Existing practice history is preserved.',schema({id,...listFields},['id','kid_id','title','words'])],
 ['add_verse','Add parent-provided verse wording; never fetch translations.',schema({kid_id:id,reference:text(120),text:text(2000),translation:{type:'string',maxLength:60},due_date:{type:'string',format:'date'}},['kid_id','reference','text'])],
 ['get_progress','Read a kid’s progress summary, not raw typed answers.',schema({kid_id:id},['kid_id'])],
].map(([name,description,inputSchema])=>({name,description,inputSchema,annotations:{readOnlyHint:!['add_spelling_list','update_spelling_list','add_verse'].includes(name),destructiveHint:false,openWorldHint:false}}));
const writable=name=>['add_spelling_list','update_spelling_list','add_verse'].includes(name);
function valid(value,s) {
 if(s.type==='object')return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>Object.hasOwn(s.properties,k)&&valid(value[k],s.properties[k]))&&(s.required||[]).every(k=>Object.hasOwn(value,k));
 if(s.type==='integer')return Number.isSafeInteger(value)&&value>=s.minimum;
 if(s.type==='array')return Array.isArray(value)&&value.length>=s.minItems&&value.length<=s.maxItems&&value.every(v=>valid(v,s.items));
 if(s.type==='string')return typeof value==='string'&&value.length<=(s.maxLength??Infinity)&&value.trim().length>=(s.minLength??0)&&(!s.format||(/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value));
 return false;
}
export function initConnections(sql) {
 sql.exec('CREATE TABLE IF NOT EXISTS mcp_connections(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,name TEXT NOT NULL,scope TEXT NOT NULL,created_at TEXT NOT NULL,last_used_at TEXT); CREATE TABLE IF NOT EXISTS mcp_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL)');
}
export const connectionFields='id,name,scope,created_at,last_used_at';
export async function createConnection(sql,familyHash,b) {
 if(!b||Object.keys(b).some(k=>!['name','scope'].includes(k))||typeof b.name!=='string'||!b.name.trim()||b.name.length>80||!['add-read','read-only'].includes(b.scope??'add-read'))throw Object.assign(Error('Use a name (1–80 characters) and add-read or read-only scope'),{status:400});
 if([...sql.exec('SELECT COUNT(*) n FROM mcp_connections')][0].n>=5)throw Object.assign(Error('Maximum 5 connections; revoke one first'),{status:400});
 const random=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const token=`fp_${familyHash}_${random}`,connection={id:crypto.randomUUID(),name:b.name.trim(),scope:b.scope??'add-read',created_at:new Date().toISOString(),last_used_at:null};
 sql.exec('INSERT INTO mcp_connections VALUES(?,?,?,?,?,?)',connection.id,await sha256(token),connection.name,connection.scope,connection.created_at,null);
 return {connection,token};
}
export function routeToken(request) {
 const path=new URL(request.url).pathname;
 const link=path.startsWith('/mcp/t/')?path.slice(7):null;
 const authorization=request.headers.get('Authorization');
 // Never let a conflicting header silently switch a connection URL's identity.
 if(link!==null && authorization && authorization!=='Bearer '+link)return null;
 return /^Bearer (fp_([a-f0-9]{64})_[a-f0-9]{64})$/.exec(link===null?authorization||'':'Bearer '+link);
}
export async function handleMcp(request,sql,run) {
 const url=new URL(request.url);
 if(request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'Cross-origin request denied'},403);
 if(request.method!=='POST')return json({error:'Method not allowed'},405,{Allow:'POST'});
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
 if(!call||typeof call!=='object'||Array.isArray(call)||call.jsonrpc!=='2.0'||typeof call.method!=='string'||(Object.hasOwn(call,'id')&&!(typeof call.id==='string'||typeof call.id==='number'&&Number.isFinite(call.id)))||(call.params!==undefined&&(!call.params||typeof call.params!=='object'||Array.isArray(call.params))))return error(null,-32600,'Invalid request; batches are not supported');
 const version=request.headers.get('MCP-Protocol-Version');
 if(version&&!versions.includes(version))return error(call.id??null,-32600,'Unsupported MCP protocol version');
 sql.exec('UPDATE mcp_connections SET last_used_at=? WHERE id=?',new Date(now).toISOString(),connection.id);
 if(!Object.hasOwn(call,'id'))return new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});
 const ok=result=>json({jsonrpc:'2.0',id:call.id,result});
 if(call.method==='initialize') {
  if(typeof call.params?.protocolVersion!=='string'||!call.params.capabilities||typeof call.params.capabilities!=='object'||Array.isArray(call.params.capabilities)||!call.params.clientInfo||typeof call.params.clientInfo.name!=='string'||typeof call.params.clientInfo.version!=='string')return error(call.id,-32602,'Invalid initialize parameters');
  return ok({protocolVersion:versions.includes(call.params.protocolVersion)?call.params.protocolVersion:MCP_VERSION,capabilities:{tools:{listChanged:false}},serverInfo:{name:'Family Practice',version:'1.0.0'},instructions:'Family-scoped parent-managed practice. Supply verse wording yourself. No deletion or account tools.'});
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
