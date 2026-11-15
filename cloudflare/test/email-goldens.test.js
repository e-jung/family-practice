import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildWeeklyDigest,buildPracticeNotice} from '../emails.js';

const common={familyName:'Example family',practiceUrl:'https://example.test/',unsubscribe:'https://example.test/auth/unsubscribe?token=example&test=1'};
export const examples={
 weekly:buildWeeklyDigest({...common,kids:[{name:'Sam',attempts:4,accuracy:75,practiceDays:3,streak:2,dueWords:3,lists:['Autumn week'],trickyWords:['friend','light'],verseStarsChange:2},{name:'Alex',attempts:0,practiceDays:0,dueWords:1}]}),
 review:buildPracticeNotice({...common,kind:'review',dueWords:4}),
 class:buildPracticeNotice({...common,kind:'classUpdates'})
};
for(const [name,message] of Object.entries(examples))test(`${name} email HTML and plain-text goldens`,()=>{
 for(const format of ['html','text'])assert.equal(message[format]+'\n',readFileSync(new URL(`./goldens/${name}.${format==='text'?'txt':'html'}`,import.meta.url),'utf8'));
 assert.match(message.html,/max-width:600px/);
 assert.match(message.html,/role="presentation"/);
 assert.match(message.html,/#2446A8/);
 assert.doesNotMatch(message.html,/<style|<script|<img|<link|@import|url\(/i);
 assert.match(message.html,/Open Spellami<\/a>/);
 assert.match(message.html,/Manage email preferences<\/a>/);
 assert.match(message.html,/Unsubscribe<\/a>/);
 assert.match(message.text,name==='weekly' ? /You're receiving this because you turned on weekly summaries\./ : /You’re receiving this because you opted in/);
});

test('notice titles, family names and URLs are escaped; unsafe links are rejected',()=>{
 const message=buildPracticeNotice({...common,kind:'review',familyName:'<Family & friends>'});
 assert.match(message.html,/&lt;Family &amp; friends&gt;/);
 assert.doesNotMatch(message.html,/<Family/);
 assert.match(message.html,/token=example&amp;test=1/);
 for(const build of [buildWeeklyDigest, args=>buildPracticeNotice({...args,kind:'review'})]){
  for(const practiceUrl of ['javascript:alert(1)','http://example.test/','https://user:pass@example.test/'])assert.throws(()=>build({...common,practiceUrl}));
 }
});
