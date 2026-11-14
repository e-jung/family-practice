import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildWeeklyDigest,buildPracticeNotice,buildSignInEmail} from '../emails.js';

const common={familyName:'Example family',practiceUrl:'https://example.test/',unsubscribe:'https://example.test/auth/unsubscribe?token=example&test=1'};
export const examples={
 weekly:buildWeeklyDigest({...common,kids:[{name:'Sam',attempts:4,accuracy:75,practiceDays:3,streak:2,dueWords:3,lists:['Autumn week'],trickyWords:['friend','light'],verseStarsChange:2},{name:'Alex',attempts:0,practiceDays:0,dueWords:1}]}),
 review:buildPracticeNotice({...common,kind:'review',dueWords:4}),
 class:buildPracticeNotice({...common,kind:'classUpdates'}),
 signin:buildSignInEmail({code:'012345'})
};
for(const [name,message] of Object.entries(examples))test(`${name} email HTML and plain-text goldens`,()=>{
 for(const format of ['html','text'])assert.equal(message[format]+'\n',readFileSync(new URL(`./goldens/${name}.${format==='text'?'txt':'html'}`,import.meta.url),'utf8'));
 assert.match(message.html,/max-width:600px/);
 assert.match(message.html,/role="presentation"/);
 assert.match(message.html,/#2446A8/);
 assert.doesNotMatch(message.html,/<style|<script|<img|<link|@import|url\(/i);
 if(name!=='signin'){
  assert.match(message.html,/Open Family Practice<\/a>/);
  assert.match(message.html,/Manage email preferences<\/a>/);
  assert.match(message.html,/Unsubscribe<\/a>/);
  assert.match(message.text,name==='weekly' ? /You're receiving this because you turned on weekly summaries\./ : /You’re receiving this because you opted in/);
 }else{
  assert.match(message.html,/font-size:36px/);
  assert.match(message.html,/monospace/);
  assert.match(message.text,/012345/);
  assert.match(message.html,/If you didn&#39;t request this/);
  assert.doesNotMatch(message.html,/Unsubscribe|opted in/);
 }
});

test('notice titles, family names and URLs are escaped; unsafe links are rejected',()=>{
 const message=buildPracticeNotice({...common,kind:'review',familyName:'<Family & friends>'});
 assert.match(message.html,/&lt;Family &amp; friends&gt;/);
 assert.doesNotMatch(message.html,/<Family/);
 assert.match(message.html,/token=example&amp;test=1/);
 for(const build of [buildWeeklyDigest, args=>buildPracticeNotice({...args,kind:'review'})]){
  for(const practiceUrl of ['javascript:alert(1)','http://example.test/','https://user:pass@example.test/'])assert.throws(()=>build({...common,practiceUrl}));
 }
 assert.throws(()=>buildSignInEmail({code:'<code>'}));
});

test('sign-in producer uses the styled template without subscribing to optional mail',async()=>{
 const {routeAuth}=await import('../accounts.js');
 let stored;
 const calls=[];
 const env={SESSION_SECRET:'email-style-tests-secret-32-characters',EMAIL_TEST_SINK:'1',ACCOUNTS:{idFromName:n=>n,get:()=>({fetch:async r=>{
  const path=new URL(r.url).pathname;
  calls.push(path);
  const body=await r.json();
  if(path==='/sink')stored=body.message;
  return Response.json({ok:true});
 }})}};
 const response=await routeAuth(new Request('http://localhost/api/auth/code/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'parent@example.test'})}),env,()=>{throw Error('No provider calls');});
 assert.equal(response.status,200);
 const code=stored.text.match(/code is (\d{6})/)[1];
 assert.deepEqual({subject:stored.subject,text:stored.text,html:stored.html},buildSignInEmail({code}));
 assert.ok(!calls.includes('/prefs'));
});
