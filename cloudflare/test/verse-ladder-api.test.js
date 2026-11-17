import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyFixture} from '../fixture-support.js';
import {firstLetter, maskWords, scoreLadder, tokenize} from '../public/verse-ladder.js';

async function setup(t) {
  const f = emptyFixture(t);
  await f.req('/api/families', {name: 'Ladder tests', pin: '5678'});
  await f.req('/api/admin/kids', {name: 'Alex'});
  const verse = (await f.req('/api/admin/verses', {
    kid_id: 1, reference: 'John 11:35', text: 'Jesus wept.', translation: 'KJV',
  })).body;
  const session = (await f.req('/api/sessions', {kid_id: 1, kind: 'verse'})).body;
  const attempt = {session_id: session.id, verse_id: verse.id, mode: 'ladder'};
  return {...f, attempt};
}

test('ladder API scores all four levels on the server and preserves raw letters and wording', async t => {
  const {req, attempt} = await setup(t);
  for (const level of [1, 2, 3, 4]) {
    const mask = maskWords('Jesus wept.', level);
    const typed = tokenize('Jesus wept.').filter((_, i) => mask[i]).map(firstLetter).join('').toUpperCase();
    const result = await req('/api/verse-attempts', {...attempt, level, typed, accuracy: 1, passed: false});
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, scoreLadder('Jesus wept.', level, typed));
    assert.equal(result.body.accuracy, level === 1 ? 0 : 100);
    assert.equal(result.body.passed, true);
  }
  const miss = await req('/api/verse-attempts', {...attempt, level: 4, typed: 'xx', accuracy: 100, passed: true});
  assert.equal(miss.body.accuracy, 0);
  assert.equal(miss.body.passed, false);
  const slip = await req('/api/verse-attempts', {...attempt, level: 4, typed: 'jx'});
  assert.equal(slip.body.accuracy, 50);
  assert.equal(slip.body.passed, true);
  const backup = (await req('/api/admin/export')).body;
  assert.equal(backup.verse_attempts.length, 6);
  assert.deepEqual(backup.verse_attempts.slice(0, 4).map(a => a.level), [1, 2, 3, 4]);
  assert.equal(backup.verse_attempts[3].typed, 'JW');
  assert.equal(backup.verse_attempts[3].verse_text, 'Jesus wept.');
  assert.equal(backup.verse_attempts[3].verse_reference, 'John 11:35');
  await req('/api/admin/verses', {id: attempt.verse_id, kid_id: 1, reference: 'Edited', text: 'Changed wording here'});
  const edited = (await req('/api/admin/export')).body;
  assert.equal((await req('/api/admin/import', edited)).status, 200, 'restore validates the historical wording');
});

test('ladder API rejects malformed levels and typed shapes without recording attempts', async t => {
  const {req, attempt} = await setup(t);
  const invalid = [
    {typed: ''}, ...[0, 5, -1, 1.5, '2', null].map(level => ({level, typed: ''})),
    ...[undefined, null, 0, false, [], {}].map(typed => ({level: 1, typed})),
    {level: 1, typed: ' '}, {level: 1, typed: 'j'},
    {level: 2, typed: ''}, {level: 2, typed: 'jw'},
    {level: 4, typed: 'j'}, {level: 4, typed: 'jww'},
    {level: 4, typed: 'j '}, {level: 4, typed: 'j!'},
    {level: 4, typed: 'j😀'}, {level: 4, typed: 'x'.repeat(10001)},
  ];
  for (const body of invalid) {
    const result = await req('/api/verse-attempts', {...attempt, ...body});
    assert.equal(result.status, 400, JSON.stringify(body));
  }
  assert.equal((await req('/api/admin/export')).body.verse_attempts.length, 0);
});

test('backup round trips ladder and every legacy verse mode, rejects invalid ladder rows atomically', async t => {
  const {req, attempt} = await setup(t);
  for (const mode of ['read', 'blanks', 'first', 'memory', 'reference']) {
    const result = await req('/api/verse-attempts', {
      ...attempt, mode, typed: mode === 'reference' ? 'John 11:35' : 'Jesus wept.',
      ...(mode === 'blanks' ? {level: 100, indices: [0, 1]} : {}),
    });
    assert.equal(result.status, 200, mode);
  }
  await req('/api/verse-attempts', {...attempt, level: 4, typed: 'jw'});
  const backup = (await req('/api/admin/export')).body;
  assert.equal((await req('/api/admin/import', backup)).status, 200);
  for (const change of [
    {level: 0}, {level: 5}, {level: '4'}, {mode: 'unknown'},
    {typed: null}, {typed: []}, {typed: 'j'}, {typed: 'jw!'}, {typed: 'j '},
  ]) {
    const bad = structuredClone(backup);
    Object.assign(bad.verse_attempts.at(-1), change);
    assert.equal((await req('/api/admin/import', bad)).status, 400, JSON.stringify(change));
    const current = (await req('/api/admin/export')).body;
    assert.deepEqual(current.verse_attempts, backup.verse_attempts, 'failed imports leave attempts intact');
  }
});

test('kid resume is a safe aggregate of all current-wording ladder attempts', async t => {
  const {req, attempt} = await setup(t);
  await req('/api/verse-attempts', {...attempt, level: 2, typed: 'j'});
  // A later failed attempt must not reset the most recent passed step.
  await req('/api/verse-attempts', {...attempt, level: 4, typed: 'xx'});
  await req('/api/parent/lock', {});
  let progress = (await req('/api/progress?kid=1')).body;
  assert.deepEqual(progress.ladderSteps, [{id: attempt.verse_id, step: 3}]);
  assert.equal(progress.verseAttempts, undefined);
  await req('/api/parent/unlock', {pin: '5678'});
  // More than the 100-entry UI history window must not erase the passed step.
  for (let i = 0; i < 101; i++) await req('/api/verse-attempts', {...attempt, mode: 'read', typed: ''});
  progress = (await req('/api/progress?kid=1')).body;
  assert.equal(progress.ladderSteps[0].step, 3);
  await req('/api/admin/verses', {id: attempt.verse_id, kid_id: 1, reference: 'John 11:35', text: 'Jesus wept!'});
  assert.equal((await req('/api/progress?kid=1')).body.ladderSteps[0].step, 1);
});
