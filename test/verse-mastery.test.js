import test from 'node:test';
import assert from 'node:assert/strict';
import {verseMastery, verseMasteryCopy, VERSE_MASTERY_POLICY} from '../cloudflare/public/verse-mastery.js';

const verse = {id: 1, reference: 'John 11:35', text: 'Jesus wept.'};
const attempt = (mode, accuracy, extra = {}) => ({
  verse_id: verse.id, verse_reference: verse.reference, verse_text: verse.text, mode, accuracy, ...extra,
});

test('mastery preserves score boundaries and which modes earn the third star', () => {
  for (const [mode, accuracy, stars] of [
    ['blanks', 69, 0], ['blanks', 70, 1], ['blanks', 94, 1], ['blanks', 95, 2],
    ['memory', 94, 1], ['memory', 95, 3], ['first', 95, 3], ['reference', 100, 2], ['read', 100, 0],
  ]) {
    assert.deepEqual(verseMastery(verse, [attempt(mode, accuracy)]), {
      id: verse.id, reference: verse.reference, best: mode === 'read' ? 0 : accuracy, stars, attempts: 1,
    }, `${mode} at ${accuracy}%`);
  }
  assert.deepEqual(verseMastery(verse, []), {id: 1, reference: verse.reference, best: 0, stars: 0, attempts: 0});
});

test('history matches exact wording and reference before taking the newest ten; reads occupy the window', () => {
  const ignored = [
    attempt('memory', 100, {verse_id: 2}),
    attempt('memory', 100, {verse_text: 'Jesus wept!'}),
    attempt('memory', 100, {verse_reference: 'John 11:36'}),
    attempt('memory', 100, {verse_text: '', verse_reference: ''}),
  ];
  const attempts = [...ignored, attempt('blanks', 70), ...Array.from({length: 9}, () => attempt('read', 100)),
    attempt('memory', 100)];
  const before = structuredClone(attempts);
  assert.deepEqual(verseMastery(verse, attempts), {id: 1, reference: verse.reference, best: 70, stars: 1, attempts: 10});
  assert.equal(verseMastery(verse, [...Array.from({length: 10}, () => attempt('read', 100)), ...attempts]).stars, 0);
  assert.deepEqual(attempts, before, 'does not mutate input history');
});

test('UI explanation comes from the shared thresholds and preserves current copy', () => {
  assert.equal(VERSE_MASTERY_POLICY.recentAttempts, 10);
  assert.equal(verseMasteryCopy(),
    'One star: 70%+. Two: 95%+. Three: 95%+ on the last Learn-it step. Read & listen and Learn-it step 1 don’t earn stars.');
});

test('ladder type-along earns nothing; only final step can earn three stars', () => {
  for (const [level, stars] of [[1, 0], [2, 2], [3, 2], [4, 3]]) {
    assert.equal(verseMastery(verse, [attempt('ladder', 100, {level})]).stars, stars);
  }
});
