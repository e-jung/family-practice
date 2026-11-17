import assert from 'node:assert/strict';
const origin=process.env.SMOKE_URL || 'http://localhost:8792';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw Error('Smoke tests require localhost');
let code='',cookie='',checks=0,requests=0;
const isLocal=['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname);
const smokeIp=`198.18.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*254)+1}`;
const families=new Map();
const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
async function req(path,data,options={}) {
  requests++;
  const r=await fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{'X-Family-Code':code,cookie,...(isLocal?{'CF-Connecting-IP':smokeIp}:{}),...(data===undefined?{}:{'Content-Type':'application/json'}),...options},body:data===undefined?undefined:JSON.stringify(data)});
  if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  const text=await r.text();return {status:r.status,body:r.headers.get('Content-Type')?.includes('json')?JSON.parse(text):text};
}
async function createFamily(name,pin) {
  const result=await req('/api/families',{name,pin,smoke:true});
  if(result.status===201 && result.body.code)families.set(result.body.code,{name,pin});
  if(result.status===429)throw Error(`Local smoke family creation was rate-limited (HTTP 429): ${result.body.error || 'creation quota reached'}. Wait for the quota window to reset or use a fresh disposable local Wrangler state directory; deleting families does not reset the creation quota.`);
  check(result.status,201);
  return result;
}
let smokeError;
try {
  check((await req('/')).status,200);
  const a=await createFamily('Smoke A','1234');code=a.body.code;const codeA=code,cookieA=cookie;
  check((await req('/api/state')).body.kids,[]);
  const tts=await req('/api/tts?text=hello&lang=en');if(process.env.SMOKE_EXPECT_AI){check(tts.status,200);}else{check(tts.status,503);check(tts.body.error,'voice_unavailable');}
  check((await req('/api/admin/kids',{name:'Alex'})).status,200);
  const list=await req('/api/admin/lists',{kid_id:1,title:'One word',words:[{word:'friend',sentence:'My friend is kind.'}]});check(list.status,201);
  const verse=await req('/api/admin/verses',{kid_id:1,reference:'John 11:35',text:'Jesus wept.',translation:'KJV'});check(verse.status,201);
  const connection=await req('/api/admin/connections',{name:'Disposable smoke assistant',scope:'add-read'});check(connection.status,201);
  const token=connection.body.token;
  const rpc=(method,params={})=>req('/mcp/t/'+token,{jsonrpc:'2.0',id:1,method,params});
  check((await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'Local smoke',version:'1'}})).body.result.protocolVersion,'2025-11-25');
  check((await req('/mcp/t/'+token)).status,405);
  check((await req('/mcp/t/'+token,{jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
  check((await rpc('tools/list')).body.result.tools.length,9);
  const tool=async(name,args={})=>{const r=await rpc('tools/call',{name,arguments:args});check(r.status,200);check(r.body.result.isError,undefined);return JSON.parse(r.body.result.content[0].text);};
  check((await tool('list_kids')).kids[0].name,'Alex');
  check((await tool('list_spelling_lists',{kid:1})).lists.length,1);
  check((await tool('get_spelling_list',{list_id:list.body.id})).list.words[0].word,'friend');
  const mcpList=(await tool('add_spelling_list',{kid:1,title:'Assistant list',words:[{word:'kind'}]})).list;
  check((await tool('update_spelling_list',{list_id:mcpList.id,title:'Updated assistant list',words:[{word:'light',sentence:'Turn on the light.'}]})).list.words[0].word,'light');
  check(Number.isSafeInteger((await tool('add_verse',{kid:1,reference:'John 11:35',text:'Jesus wept.',translation:'KJV'})).id),true);
  check((await tool('get_progress',{kid:1})).attempts,undefined);
  check((await req('/api/admin/connections')).body.connections[0].token,undefined);
  const readOnly=await req('/api/admin/connections',{name:'Read only smoke',scope:'read-only'});check(readOnly.status,201);
  check((await req('/mcp/t/'+readOnly.body.token,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'add_verse',arguments:{kid:1,reference:'John 11:35',text:'Jesus wept.'}}})).body.result.isError,true);
  check((await req('/api/admin/connections/revoke',{id:readOnly.body.connection.id})).status,200);
  check((await req('/mcp/t/'+readOnly.body.token,{jsonrpc:'2.0',id:2,method:'ping'})).status,401);
  const state=(await req('/api/state?kid=1')).body;
  check((await req('/api/parent/lock',{})).status,200);
  check((await req('/api/admin/export')).status,401);
  const session=(await req('/api/sessions',{kid_id:1,list_id:list.body.id,kind:'spelling'})).body;
  check((await req('/api/attempts',{session_id:session.id,word_id:state.lists.find(l=>l.id===list.body.id).words[0].id,typed:'friend'})).body.correct,true);
  check((await req('/api/sessions/complete',{session_id:session.id})).status,200);
  check((await req('/api/progress?kid=1')).body.listsCompleted,1);
  const vs=(await req('/api/sessions',{kid_id:1,kind:'verse'})).body;
  check((await req('/api/verse-attempts',{session_id:vs.id,verse_id:verse.body.id,mode:'memory',typed:'Jesus wept!'})).body.accuracy,100);
  const ladder={session_id:vs.id,verse_id:verse.body.id,mode:'ladder'};
  for(const [level,typed] of [[1,''],[2,'j'],[3,'j'],[4,'jw']]) {
    const result=await req('/api/verse-attempts',{...ladder,level,typed});
    check(result.status,200);check(result.body.accuracy,level===1?0:100);check(result.body.passed,true);
  }
  const ladderMiss=await req('/api/verse-attempts',{...ladder,level:4,typed:'xx',accuracy:100,passed:true});
  check(ladderMiss.status,200);check(ladderMiss.body.accuracy,0);check(ladderMiss.body.passed,false);
  for(const invalid of [
    {level:0,typed:''},{level:5,typed:''},{level:'4',typed:'jw'},
    {level:1},{level:1,typed:null},{level:1,typed:0},{level:1,typed:' '},
    {level:4,typed:'j'},{level:4,typed:'jww'},{level:4,typed:'j!'},
  ])check((await req('/api/verse-attempts',{...ladder,...invalid})).status,400);
  check((await req('/api/parent/unlock',{pin:'1234'})).status,200);
  const backup=(await req('/api/admin/export')).body;
  check(backup.verse_attempts.filter(a=>a.mode==='ladder').length,5);
  const badLadder=structuredClone(backup);badLadder.verse_attempts.find(a=>a.mode==='ladder').level=5;
  check((await req('/api/admin/import',badLadder)).status,400);
  check((await req('/api/admin/import',backup)).status,200);
  const restored=(await req('/api/admin/export')).body;
  check({...restored,exported_at:''},{...backup,exported_at:''});
  const b=await createFamily('Smoke B','5678');code=b.body.code;const codeB=code,cookieB=cookie;
  check((await req('/api/state?kid=1')).body.kids,[]);
  check((await req('/api/admin/kids',{name:'Sam'})).status,200);
  check((await req('/api/admin/sample',{kid_id:1})).status,200);
  cookie=cookieA;check((await req('/api/admin/export')).status,401);
  check((await req('/api/state')).body.parent,false);
  code=codeA;cookie=cookieB;check((await req('/api/admin/export')).status,401);
  check((await req('/api/state')).body.kids[0].name,'Alex');
  check((await tool('list_kids')).kids[0].name,'Alex');
  cookie=cookieA;
  check((await req('/api/admin/connections/revoke-all',{})).status,200);
  check((await rpc('ping')).status,401);
  check((await req('/api/admin/delete-family',{pin:'1234',confirmation:'Smoke A'})).status,200);families.delete(codeA);
  check((await req('/api/state')).status,404);
  code=codeB;cookie=cookieB;check((await req('/api/state')).body.kids[0].name,'Sam');
  check((await req('/api/admin/delete-family',{pin:'5678',confirmation:'Smoke B'})).status,200);families.delete(codeB);
  check((await req('/api/state')).status,404);
} catch(error) {
  smokeError=error;
  throw error;
} finally {
  const cleanupErrors=[];
  for(const [familyCode,{name,pin}] of families) {
    try {
      code=familyCode;cookie='';
      const unlocked=await req('/api/parent/unlock',{pin});
      if(unlocked.status!==200)throw Error(`unlock returned HTTP ${unlocked.status}`);
      const deleted=await req('/api/admin/delete-family',{pin,confirmation:name});
      if(deleted.status!==200)throw Error(`delete returned HTTP ${deleted.status}`);
      families.delete(familyCode);
    } catch(error) {
      cleanupErrors.push(new Error(`Failed to clean up ${name}: ${error.message}`,{cause:error}));
    }
  }
  if(cleanupErrors.length)throw new AggregateError(smokeError?[smokeError,...cleanupErrors]:cleanupErrors,'Local smoke failed to clean up disposable families');
}
console.log(`PASS: ${requests} local HTTP requests, ${checks} assertions; two families, practice, restore, MCP tools/scopes/revocation, cross-family isolation and deletion.`);
