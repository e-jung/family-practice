import assert from 'node:assert/strict';
const origin=process.env.SMOKE_URL||'http://localhost:8792';
const isLocal=['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname);
if(!isLocal)throw Error('Disposable localhost only');
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const smokeIp=`198.18.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*254)+1}`;
const family=()=>({code:'',cookie:''});const a=family(),b=family();
async function req(f,path,data,method=data===undefined?'GET':'POST') {
 const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json','X-Family-Code':f.code,Cookie:f.cookie,...(isLocal?{'CF-Connecting-IP':smokeIp}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 if(r.headers.has('set-cookie'))f.cookie=r.headers.get('set-cookie').split(';')[0];
 const body=r.headers.get('Content-Type')?.includes('json')?await r.json():await r.text();
 return {status:r.status,body,headers:r.headers};
}
async function ok(f,path,data,status=200,method){const r=await req(f,path,data,method);assert.equal(r.status,status,`${path}: ${JSON.stringify(r.body)}`);checks++;return r.body;}
const anonymous=family();let slug,cls,firstWeek,publishedAt;
try{
 for(const [f,name] of [[a,'Sharing smoke A'],[b,'Sharing smoke B']]){f.code=(await ok(f,'/api/families',{name,pin:'1234'},201)).code;}
 await ok(a,'/api/admin/kids',{name:'Alex'});
 for(const name of ['Sam','Casey'])await ok(b,'/api/admin/kids',{name});
 const list=await ok(a,'/api/admin/lists',{kid_id:1,title:'Kind words',words:[{word:'friend',sentence:'A friend is kind.'},{word:'light',sentence:'The light is bright.'}]},201);
 const verse=await ok(a,'/api/admin/verses',{kid_id:1,reference:'John 11:35',text:'Jesus wept.',translation:'KJV'},201);
 const shared=await ok(a,'/api/admin/shares',{list_id:list.id,note:'A weekly packet',verse_id:verse.id},201);slug=shared.share.slug;
 const publicShare=(await ok(anonymous,'/api/share/'+slug)).share;
 eq(publicShare.words[0].sentence,'A friend is kind.');
 for(const field of ['kid_id','family','family_code','progress','pin','owner'])eq(publicShare[field],undefined);
 const shell=await req(anonymous,'/s/'+slug);eq(shell.status,200);assert.match(shell.headers.get('X-Robots-Tag'),/\bnoindex\b/);checks++;assert.match(shell.body,/<meta name="robots" content="noindex"/);checks++;
 eq((await req(b,'/api/admin/shares/'+slug+'/stop',{})).status,404);
 const klass=await ok(a,'/api/admin/classes',{name:'Weekly class'},201);cls=klass.class.slug;
 const published=await ok(a,'/api/admin/classes/'+cls+'/publish',{list_id:list.id,verse_id:verse.id});firstWeek=published.week.week_id;publishedAt=Date.now();
 eq((await req(a,'/api/admin/classes/'+cls+'/publish',{list_id:list.id})).status,429);
 const feed=await ok(anonymous,'/api/class/'+cls);eq(feed.latest.words.length,2);
 const imported=await ok(b,'/api/admin/import-shared',{slug,kids:[1,2],include_verse:true});eq(imported.lists.length,2);eq(imported.verses.length,2);
 const again=await ok(b,'/api/admin/import-shared',{slug,kids:[1,2],include_verse:true});eq(again.verses.length,0);
 await ok(b,'/api/admin/follows',{slug:cls,kids:[1,2],include_verse:true});
 await ok(b,'/api/admin/import-shared',{slug:cls,kids:[1,2],include_verse:true});
 let follows=await ok(b,'/api/follows');eq(follows.follows[0].latest.week_id,firstWeek);
 const connection=await ok(b,'/api/admin/connections',{name:'Sharing smoke',scope:'add-read'},201);
 async function tool(name,args){const rpc=await ok(anonymous,'/mcp/t/'+connection.token,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});assert.equal(rpc.result.isError,undefined,JSON.stringify(rpc));checks++;return JSON.parse(rpc.result.content[0].text);}
 await tool('get_shared_list',{url_or_slug:origin+'/s/'+slug});
 await tool('import_shared_list',{url_or_slug:slug,kids:[1],include_verse:true});
 await ok(anonymous,'/api/report/'+slug,{reason:'Disposable smoke report'});
 const stateB=await ok(b,'/api/state?kid=1');const count=stateB.lists.length;
 await ok(a,'/api/admin/shares/'+slug+'/stop',{});
 const stopped=await req(anonymous,'/api/share/'+slug);eq(stopped.status,410);assert.match(stopped.body.error,/no longer shared/i);checks++;
 eq((await ok(b,'/api/state?kid=1')).lists.length,count);
 // Real Worker throttle is intentionally not bypassed. Wait before a second publish.
 const wait=Math.max(0,publishedAt+600100-Date.now());console.log(`First phase passed (${checks} checks). Waiting ${Math.ceil(wait/1000)}s for the real per-class publish interval.`);
 if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
 const second=await ok(a,'/api/admin/lists',{kid_id:1,title:'Next week',words:[{word:'peace',sentence:'We work for peace.'}]},201);
 const next=await ok(a,'/api/admin/classes/'+cls+'/publish',{list_id:second.id,verse_id:verse.id});
 eq((await ok(anonymous,'/api/class/'+cls)).weeks.length,2);
 follows=await ok(b,'/api/follows?refresh=1');eq(follows.follows[0].latest.week_id,next.week.week_id);
 await ok(b,'/api/parent/lock',{});eq((await req(b,'/api/admin/import-shared',{slug:cls,kids:[1],include_verse:true})).status,401);
 await ok(b,'/api/parent/unlock',{pin:'1234'});
 await ok(b,'/api/admin/import-shared',{slug:cls,kids:[1],include_verse:true});
 const independent=(await ok(b,'/api/state?kid=1')).lists.find(l=>l.title==='Next week');eq(independent.words[0].word,'peace');
 console.log(`PASS: ${checks} assertions; public snapshots, 2-kid verse import, duplicate skip, follows/new week, parent gate, ownership, stopped copies and MCP round trip.`);
} finally {
 for(const [f,name]of [[a,'Sharing smoke A'],[b,'Sharing smoke B']])if(f.code){await req(f,'/api/parent/unlock',{pin:'1234'});const r=await req(f,'/api/admin/delete-family',{pin:'1234',confirmation:name});assert.equal(r.status,200);}
}
