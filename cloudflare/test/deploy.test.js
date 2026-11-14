import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deploy, buildPlan, metadataFor, MODULES } from '../deploy.mjs';
test('raw deployer builds correct asset, module, migration and secret requests without live network', async () => {
const root = await mkdtemp(join(tmpdir(), 'family-deploy-'));
try {
  await mkdir(join(root, 'cloudflare/public'),{recursive:true});
  
  await mkdir(join(root, 'lib'));
  for (const name of MODULES) await writeFile(join(root, name), '// mock source');
  await writeFile(join(root, 'cloudflare/public/index.html'), '<h1>Hi</h1>');
  await writeFile(join(root, 'cloudflare/public/app.js'), 'export {};');
  await writeFile(join(root, 'cloudflare/public/_headers'), '/*\n  X-Test: yes\n');
  await writeFile(join(root, 'cloudflare/public/_redirects'), '/old / 302\n');
  const plan = await buildPlan(root);
  assert.equal(Object.keys(plan.manifest).length, 2);
  assert.equal(plan.config._headers, '/*\n  X-Test: yes\n');
  assert.ok(!plan.manifest['/_headers'] && !plan.manifest['/_redirects']);
  assert.ok(Object.values(plan.manifest).every(x => /^[a-f0-9]{32}$/.test(x.hash)));
  const dryRun = await deploy({ root, dryRun: true, env: {}, log() {}, fetchImpl() { throw Error('Network forbidden'); } });
  assert.equal(dryRun.metadata_if_first_deployment.observability.logs.invocation_logs, false, 'bearer URLs must not enter invocation logs');
  assert.ok(dryRun.modules.some(m=>m.name==='cloudflare/mcp.js'));
  assert.ok(dryRun.modules.some(m=>m.name==='cloudflare/sharing.js'));
  assert.deepEqual(dryRun.metadata_if_live_v2.migrations, {old_tag:'v2',new_tag:'v3',steps:[{new_sqlite_classes:['ShareStore']}]});
  assert.equal(dryRun.metadata_if_live_v3.migrations, undefined);
  assert.ok(dryRun.metadata_if_first_deployment.bindings.some(b=>b.type==='ai' && b.name==='AI'));
  const env = { CF_API_TOKEN: 'private-api-token', CF_ACCOUNT_ID: 'a'.repeat(32), IP_HASH_SALT: 'i'.repeat(64), SESSION_SECRET: 's'.repeat(64) };
  const response = (result, status=200) => new Response(JSON.stringify({ success: true, result }), { status });
  for (const mode of ['first', 'upgrade', 'live-v2', 'repeat', 'fallback', 'allcached']) {
    const calls = [];
    let uploads = 0;
    const result = await deploy({ root, env, log() {}, fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      calls.push([path, options]);
      if (path.endsWith('/settings')) {
        if (mode === 'first') return response(null, 404);
        return response(mode === 'fallback' ? {} : { migration_tag: mode === 'upgrade' ? 'v1' : mode === 'live-v2' ? 'v2' : 'v3' });
      }
      if (path.endsWith('/scripts')) return response(mode === 'first' ? [] : [{ id: 'family-practice', migration_tag: 'v3' }]);
      if (path.endsWith('/assets-upload-session')) {
        assert.deepEqual(JSON.parse(options.body).manifest, { ...plan.manifest });
        const hashes = Object.values(plan.manifest).map(x => x.hash);
        return response({ jwt: 'session-jwt', buckets: mode === 'allcached' ? [] : hashes.map(x => [x]) });
      }
      if (path.endsWith('/assets/upload')) {
        assert.equal(options.headers.Authorization, 'Bearer session-jwt');
        assert.equal(new URL(url).search, '?base64=true');
        for (const [hash, file] of options.body) {
          assert.equal(await file.text(), plan.files.get(hash).bytes.toString('base64'));
          assert.equal(file.type, plan.files.get(hash).type);
        }
        return response(++uploads === 2 ? { jwt: 'completion-jwt' } : {}, uploads === 2 ? 201 : 200);
      }
      if (path.endsWith('/secrets')) {
        assert.equal(options.headers.Authorization, 'Bearer private-api-token');
        const secret = JSON.parse(options.body);
        assert.equal(secret.text, env[secret.name]);
        assert.equal(secret.type, 'secret_text');
        return response({ name: secret.name, type: secret.type });
      }
      assert.ok(path.endsWith('/scripts/family-practice'));
      assert.equal(options.method, 'PUT');
      const metadata = JSON.parse(await options.body.get('metadata').text());
      assert.ok(metadata.bindings.some(b=>b.type==='ai' && b.name==='AI'));
      assert.deepEqual(metadata.keep_bindings, ['secret_text']);
      assert.equal(metadata.assets.jwt, mode === 'allcached' ? 'session-jwt' : 'completion-jwt');
      assert.equal(metadata.main_module, 'cloudflare/worker.js');
      assert.equal(metadata.assets.config.run_worker_first, true);
      assert.equal(Boolean(metadata.migrations), ['first','upgrade','live-v2'].includes(mode));
      if (mode === 'first') assert.deepEqual(metadata.migrations, { old_tag: '', new_tag: 'v3', steps: [{ new_sqlite_classes: ['FamilyDatabase', 'RegistryLimits'] }, { new_sqlite_classes: ['TtsCache'] }, { new_sqlite_classes: ['ShareStore'] }] });
      if (mode === 'upgrade') assert.deepEqual(metadata.migrations,{old_tag:'v1',new_tag:'v3',steps:[{new_sqlite_classes:['TtsCache']},{new_sqlite_classes:['ShareStore']}]});
      if (mode === 'live-v2') assert.deepEqual(metadata.migrations, {old_tag:'v2',new_tag:'v3',steps:[{new_sqlite_classes:['ShareStore']}]});
      assert.ok(metadata.bindings.some(b=>b.name==='SHARES' && b.class_name==='ShareStore'));
      assert.ok(metadata.bindings.some(b=>b.name==='TTS_CACHE' && b.class_name==='TtsCache'));
      for (const name of MODULES) assert.equal(await options.body.get(name).text(), '// mock source');
      return response({ id: 'family-practice' });
    } });
    assert.equal(result.migrated, ['first','upgrade','live-v2'].includes(mode));
    assert.equal(calls.filter(([p]) => p.endsWith('/secrets')).length, 2);
  }
  let calls = 0;
  await assert.rejects(deploy({ root, env, log() {}, fetchImpl: async () => { calls++; return response({ migration_tag: 'v4' }); } }), /Unexpected Durable Object/);
  assert.equal(calls, 1);
  await assert.rejects(deploy({ root, env, log() {}, fetchImpl: async () => response({}, 403) }), /HTTP 403/);
  await symlink('/etc/passwd', join(root, 'cloudflare/public/secret-link'));
  await assert.rejects(buildPlan(root), /symlink/);
  console.log('PASS: no-network dry-run, manifest/config exclusion, module paths, base64 buckets/JWT auth, first migration, repeat/fallback migration skip, cached assets, secret preservation/PUTs, unknown-tag/403 fail-closed, symlink rejection.');
} finally {
  await rm(root, { recursive: true, force: true });
}

});


test('Wrangler retains deployed v1/v2 history and adds only ShareStore in v3', async () => {
  const config = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const migrations = [...config.matchAll(/\[\[migrations\]\]\s*tag = "([^"]+)"\s*new_sqlite_classes = (\[[^\]]+\])/g)]
    .map(([, tag, classes]) => ({tag, classes: JSON.parse(classes)}));
  assert.deepEqual(migrations, [
    {tag:'v1',classes:['FamilyDatabase','RegistryLimits']},
    {tag:'v2',classes:['TtsCache']},
    {tag:'v3',classes:['ShareStore']},
  ]);
  assert.match(config, /\[\[durable_objects.bindings\]\]\s*name = "SHARES"\s*class_name = "ShareStore"/);
});
