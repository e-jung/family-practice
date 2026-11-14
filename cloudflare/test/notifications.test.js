import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduledEmails} from '../notifications.js';
import {buildWeeklyDigest} from '../emails.js';
const golden='Example family — weekly practice\n\nHere is your weekly Family Practice summary.\nSam: 4 practice attempts, 75% first-try accuracy, 2-day streak, 3 words due for review.\nLists practiced: Autumn week.\nTricky words: friend, light.\nVerse stars this week: +2.';
test('weekly digest golden text covers lists, accuracy, five tricky words, review and stars',()=>{
 const message=buildWeeklyDigest({familyName:'Example family',kids:[{name:'Sam',attempts:4,accuracy:75,streak:2,dueWords:3,lists:['Autumn week'],trickyWords:['friend','light'],verseStarsChange:2}]});assert.equal(message.text,golden);
 assert.ok(!buildWeeklyDigest({kids:[{trickyWords:['1','2','3','4','5','SIXTH']}]}).text.includes('SIXTH'));
});
function fixture(){
 const account={hash:'a'.repeat(64),email:'parent@example.test',families:[{hash:'f'.repeat(64),name:'Example family'}],email_prefs:{weekly:true,review:true,classUpdates:true,timezone:'America/Los_Angeles'}};
 const claims=new Map(),messages=[],calls=[];let week='week-1';
 const env={SESSION_SECRET:'notification-test-secret-32-characters',APP_ORIGIN:'http://localhost:8792',EMAIL_TEST_SINK:'1',ACCOUNTS:{idFromName:n=>n,get:()=>({fetch:async r=>{const p=new URL(r.url).pathname,b=await r.json();calls.push(p);if(p==='/list')return Response.json({accounts:b.offset?[]:[account]});if(p==='/claim'){const key=b.hash+b.key;const claimed=claims.get(key)!==b.value;claims.set(key,b.value);return Response.json({claimed});}if(p==='/sink')messages.push(b.message);return Response.json({ok:true});}})},FAMILY:{idFromName:n=>n,get:()=>({fetch:async r=>Response.json(new URL(r.url).pathname.endsWith('follows')?{follows:[{slug:'class-link'}]}:{name:'Example family',kids:[{name:'Sam',streak:2,lists:['Autumn week'],reviewDue:3,verseStarsChange:2,attempts:[{first_try:1,correct:1},{first_try:1,correct:0}]}]})})},SHARES:{idFromName:n=>n,get:()=>({fetch:async()=>Response.json({classes:[{slug:'class-link',available:true,latest:{week_id:week}}]})})}};
 return {env,account,messages,calls,setWeek:v=>{week=v;}};
}
test('hourly cron claims local date, dedupes class updates across replay, respects unsubscribe',async()=>{
 const f=fixture(),now=new Date('2026-11-16T01:00:00Z');const forbidden=()=>{throw Error('no provider calls in sink');};await scheduledEmails(f.env,now,forbidden);assert.equal(f.messages.length,2);assert.match(f.messages[0].text,/50% first-try accuracy/);assert.match(f.messages[0].text,/Tricky words/);assert.match(f.messages[0].headers['List-Unsubscribe'],/auth\/unsubscribe\?token=/);
 await scheduledEmails(f.env,now,forbidden);assert.equal(f.messages.length,2);f.setWeek('week-2');await scheduledEmails(f.env,now,forbidden);assert.equal(f.messages.length,3);
 f.account.email_prefs={weekly:false,review:false,classUpdates:false};await scheduledEmails(f.env,new Date('2026-11-23T01:00:00Z'),forbidden);assert.equal(f.messages.length,3);
});
test('review nudges only Tuesday and Friday local time, replay safe, never retry rejected provider',async()=>{
 const f=fixture();f.account.email_prefs.classUpdates=false;f.account.email_prefs.weekly=false;
 for(const date of ['2026-11-17T01:00:00Z','2026-11-18T01:00:00Z','2026-11-18T01:00:00Z','2026-11-19T01:00:00Z','2026-11-21T01:00:00Z'])await scheduledEmails(f.env,new Date(date));assert.equal(f.messages.length,2);
 delete f.env.EMAIL_TEST_SINK;f.env.RESEND_API_KEY='mock';let requests=0;const reject=async()=>{requests++;return new Response('',{status:500});};await scheduledEmails(f.env,new Date('2026-11-25T01:00:00Z'),reject);await scheduledEmails(f.env,new Date('2026-11-25T01:00:00Z'),reject);assert.equal(requests,1);assert.ok(f.calls.includes('/mail-failed'));
});

test('multi-family summaries cover all fifty possible children',()=>{const result=buildWeeklyDigest({kids:Array.from({length:50},(_,i)=>({name:'Kid '+i,dueWords:i}))});for(let i=0;i<50;i++)assert.ok(result.text.includes('Kid '+i+':'));});
