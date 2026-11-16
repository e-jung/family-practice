import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deploy, main} from '../deploy.mjs';
import {defaults, load, validate} from '../settings.js';
import {emptyFixture} from '../fixture-support.js';

test('invalid settings stop even a dry run before network or asset preparation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'spellami-settings-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  await mkdir(join(root, 'cloudflare'));
  for (const value of [{...defaults, mailDaily:0}, {...defaults, reviewBatch:1.5}, {unexpected:true}]) {
    await writeFile(join(root, 'cloudflare/settings.json'), JSON.stringify(value));
    await assert.rejects(deploy({root, dryRun:true, fetchImpl() { throw Error('Network forbidden'); }}), /Invalid settings/);
  }
  await writeFile(join(root, 'cloudflare/settings.json'), '{');
  await assert.rejects(deploy({root, dryRun:true}), /Invalid settings/);
});

test('settings defaults are valid and malformed input falls back to the same policy', () => {
  assert.deepEqual(validate(defaults), []);
  assert.deepEqual(load('{').value, defaults);
  assert.deepEqual(load(undefined).value, defaults);
  assert.ok(validate({...defaults, notifications:{weekly:{day:7, hour:24}, review:{days:[2,2], hour:17}}}).length);
});

test('lower family voice budget trips earlier in the real Worker and registry', async t => {
  const f = emptyFixture(t);
  f.env.SETTINGS = JSON.stringify({...defaults, voice:{...defaults.voice, familyDaily:7}});
  f.env.AI = {run:async () => ({audio:btoa('ID3test audio')})};
  await f.req('/api/families', {name:'Voice settings', pin:'1234'});
  assert.equal((await f.req('/api/tts?text=hello')).status, 200);
  const limited = await f.req('/api/tts?text=world');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'voice_quota');
});

test('neutral deployment has no shared identity, sender or legacy host and code/PIN still works', async t => {
  const plan = await deploy({dryRun:true, env:{}, log() {}});
  const bindings = plan.metadata_if_live_v4.bindings;
  assert.equal(bindings.some(b => b.name === 'ACCOUNTS_SVC'), false);
  for (const name of ['SIGNIN_EMAIL', 'SIGNIN_GOOGLE']) assert.equal(bindings.find(b => b.name === name).text, '0');
  for (const name of ['LEGACY_HOSTS', 'EMAIL_FROM']) assert.equal(bindings.find(b => b.name === name).text, '');
  await assert.rejects(deploy({env:{}}), /APP_ORIGIN/);
  const f = emptyFixture(t);
  assert.deepEqual((await f.req('/api/auth/config')).body, {email:false, google:false, sso:false});
  assert.equal((await f.req('/api/families', {name:'Code only', pin:'1234'})).status, 201);
  assert.equal((await f.req('/api/parent/lock', {})).status, 200);
  assert.equal((await f.req('/api/parent/unlock', {pin:'1234'})).status, 200);
  assert.equal((await f.req('/api/admin/kids', {name:'Sample'})).status, 200);
});

test('both instance CLI forms select the same hosted configuration', async () => {
  const original = console.log;
  console.log = () => {};
  try {
    const spaced = await main(['--instance', 'jesklabs', '--dry-run']);
    const equals = await main(['--instance=jesklabs', '--dry-run']);
    assert.deepEqual(spaced, equals);
  } finally { console.log = original; }
});

test('runtime caches validated settings and reports bad or missing settings only once', async () => {
  const {settingsFor} = await import('../runtime-settings.js?settings-cache-test');
  const previous = console.error, errors = [];
  console.error = (...args) => errors.push(args);
  try {
    const good = {SETTINGS:JSON.stringify(defaults)};
    assert.equal(settingsFor(good), settingsFor(good));
    assert.deepEqual(settingsFor({SETTINGS:'{'}), defaults);
    assert.deepEqual(settingsFor({}), defaults);
    assert.equal(errors.length, 1);
    assert.deepEqual(settingsFor(good), defaults);
  } finally { console.error = previous; }
});
