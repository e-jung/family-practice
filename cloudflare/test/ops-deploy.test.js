import test from 'node:test';
import assert from 'node:assert/strict';
import {deploy} from '../deploy.mjs';
test('deployer writes optional provider secrets only if supplied and warns on omission without exposing secrets',async()=>{
  for(const enabled of [false,true]) {
    const env={CF_API_TOKEN:'private-token',CF_ACCOUNT_ID:'a'.repeat(32),SESSION_SECRET:'s'.repeat(32),IP_HASH_SALT:'i'.repeat(32),...(enabled?{OPS_TOKEN:'private-ops-token',GOOGLE_CLIENT_ID:'private-google-id',GOOGLE_CLIENT_SECRET:'private-google-secret',RESEND_API_KEY:'private-resend-key',EMAIL_FROM:'Practice <mail@example.test>'}:{})};
    const logs=[],secrets=[];
    await deploy({env,log:message=>logs.push(message),fetchImpl:async(url,options)=>{
      const path=new URL(url).pathname;
      let result={};
      if(path.endsWith('/settings')) result={migration_tag:'v2'};
      else if(path.endsWith('/assets-upload-session')) result={jwt:'private-upload-jwt',buckets:[]};
      else if(path.endsWith('/scripts/family-practice')) { const metadata=JSON.parse(await options.body.get('metadata').text()); assert.equal(metadata.bindings.find(b=>b.name==='EMAIL_FROM').text,env.EMAIL_FROM||'Spellami <spellami@jesklabs.com>'); }
      else if(path.endsWith('/secrets')) { const secret=JSON.parse(options.body);secrets.push(secret); }
      return Response.json({success:true,result});
    }});
    assert.deepEqual(secrets.map(s=>s.name),['SESSION_SECRET','IP_HASH_SALT',...(enabled?['OPS_TOKEN','RESEND_API_KEY']:[])]);
    assert.equal(logs.some(x=>x.includes('Warning: OPS_TOKEN')),!enabled);
    assert.ok(!logs.join('\n').includes('private-ops-token'));
    if(enabled) assert.equal(secrets.at(-1).text,env.RESEND_API_KEY);
    for (const secret of secrets) assert.ok(!logs.join('\n').includes(secret.text));
  }
});
