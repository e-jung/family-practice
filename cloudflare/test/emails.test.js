import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyDigest, selectForHour, sendEmail } from '../emails.js';

test('weekly digest includes escaped bounded summaries, never arbitrary kid properties', () => {
  const result = buildWeeklyDigest({familyName:'A <family>', kids:[{name:'<Sam>', attempts:4,accuracy:75,streak:2,dueWords:3,answer:'private answer',code:'private-code'}],practiceUrl:'https://example.test/',unsubscribe:'https://example.test/unsubscribe/token'});
  assert.match(result.text, /4 practice attempts, 75% first-try accuracy, 2-day streak, 3 words/);
  assert.match(result.html, /&lt;Sam&gt;/);
  assert.ok(!result.html.includes('<Sam>'));
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.match(buildWeeklyDigest().text, /good place to start/);
  assert.throws(()=>buildWeeklyDigest({practiceUrl:'javascript:alert(1)'}));
});

test('hour selection uses IANA local weekday/hour, opt-in, invalid settings and DST', () => {
  const prefs = {timezone:'America/Los_Angeles',digest:{enabled:true,day:0,hour:8},reminder:{enabled:true,days:[6],hour:8}};
  assert.equal(selectForHour(prefs,'2026-11-15T16:00:00Z','digest'),true);
  assert.equal(selectForHour(prefs,'2026-11-15T15:00:00Z','digest'),false);
  assert.equal(selectForHour(prefs,'2026-11-14T16:00:00Z','reminder'),true);
  assert.equal(selectForHour(prefs,'2026-11-15T16:00:00Z','reminder'),false);
  assert.equal(selectForHour({...prefs,timezone:'invalid'},Date.now(),'digest'),false);
  assert.equal(selectForHour({enabled:false,hour:8},'2026-11-15T08:00:00Z','digest'),false);
  assert.equal(selectForHour({enabled:true,hour:24},Date.now(),'digest'),false);
  assert.equal(selectForHour(prefs,'invalid','digest'),false);
  const dst = {timezone:'America/Los_Angeles',enabled:true,day:0,hour:1};
  assert.equal(selectForHour(dst,'2026-11-01T08:00:00Z','digest'),true);
  assert.equal(selectForHour(dst,'2026-11-01T09:00:00Z','digest'),true); // AccountStore must claim local date before delivery.
  assert.equal(selectForHour({...dst,hour:2},'2026-03-08T10:00:00Z','digest'),false); // nonexistent local hour
});

const message = {to:'parent@example.test',subject:'Practice',text:'A little practice',html:'<p>A little practice</p>',unsubscribe:'https://example.test/unsubscribe/token'};
test('email makes one Resend request with unsubscribe headers and no credential leakage', async () => {
  let calls=0;
  const result=await sendEmail({EMAIL_FROM:'Practice <hello@example.test>',RESEND_API_KEY:'private-key'},message,async (url,options)=>{
    calls++;
    assert.equal(url,'https://api.resend.com/emails');
    assert.equal(options.headers.Authorization,'Bearer private-key');
    assert.equal(options.redirect,'error');
    const body=JSON.parse(options.body);
    assert.deepEqual(body.headers,{'List-Unsubscribe':'<https://example.test/unsubscribe/token>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'});
    assert.deepEqual(body.to,['parent@example.test']);
    return Response.json({id:'provider-id'});
  });
  assert.deepEqual(result,{sent:true});assert.equal(calls,1);
  for(const status of [429,500]) {
    calls=0;
    assert.deepEqual(await sendEmail({EMAIL_FROM:'Practice <hello@example.test>',RESEND_API_KEY:'key'},
message,async()=>{calls++;return new Response('secret body',{status});}),{sent:false,reason:'email_rejected',
status});

    assert.equal(calls,1);
  }
  assert.deepEqual(await sendEmail({EMAIL_FROM:'Practice <hello@example.test>',RESEND_API_KEY:'key'},
message,async()=>{throw Error('secret');}),{sent:false,reason:'email_unavailable'});

  assert.deepEqual(await sendEmail({},message,()=>{throw Error('network forbidden');}),{sent:false,reason:'email_unconfigured'});
});

test('local sink returns content for account-owned persistence, never calls provider; production refuses sink', async () => {
  const sink=await sendEmail({EMAIL_FROM:'Practice <hello@example.test>',EMAIL_TEST_SINK:'1',
APP_ORIGIN:'http://localhost:8792'},message,()=>{throw Error('network forbidden');});

  assert.equal(sink.test,true);assert.deepEqual(sink.message.to,[message.to]);
  for(const origin of [undefined,'https://spelling.example.test','http://localhost.evil.test']) {
    await assert.rejects(sendEmail({EMAIL_FROM:'Practice <hello@example.test>',EMAIL_TEST_SINK:'1',APP_ORIGIN:origin},message),/local-only/);
  }
  await assert.rejects(sendEmail({}, {...message,subject:'Bad\r\nBcc: someone@example.test'}));
  await assert.rejects(sendEmail({}, {...message,to:'x@example.test\n'}));
});
