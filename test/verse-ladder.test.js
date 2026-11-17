import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenize, maskWords, allowance, transition, createLadder, ladderReducer,
  scoreLadder, startingStep} from '../cloudflare/public/verse-ladder.js';
const text = 'The LORD is my shepherd; I shall not want.';
test('tokenization ignores punctuation, preserves apostrophes, hyphens and numbers', () => {
  assert.deepEqual(tokenize('“God’s” loving-kindness, 123!'), ['God’s', 'loving-kindness', '123']);
});
test('spread is deterministic, nested, and covers empty and tiny passages', () => {
  assert.deepEqual(maskWords(text, 2), [false, true, false, false, true, false, true, false, false]);
  for (const verse of [text, '', 'Jesus wept.', 'God', 'a b c d e f g h i j k l m n']) {
    let previous = tokenize(verse).map(() => false);
    for (let step = 1; step <= 4; step++) {
      const mask = maskWords(verse, step);
      assert.deepEqual(mask, maskWords(verse, step));
      assert.ok(mask.every((hidden, i) => !previous[i] || hidden));
      if (step === 4) assert.ok(mask.every(Boolean));
      previous = mask;
    }
  }
  assert.throws(() => maskWords(text, 0), RangeError);
});
test('allowance and transition keep failures at their step and celebrate final pass', () => {
  assert.deepEqual([0, 1, 10, 11, 19, 20, 31].map(allowance), [1, 1, 1, 1, 1, 2, 3]);
  assert.deepEqual(transition(1, 0, 0), {step: 2, passed: true, learned: false});
  assert.deepEqual(transition(3, 2, 6), {step: 3, passed: false, learned: false});
  assert.deepEqual(transition(4, 1, 9), {step: 4, passed: true, learned: true});
  assert.throws(() => allowance(-1), RangeError);
});
test('reducer advances each word; visible mistakes never score; done ignores keys', () => {
  let state = createLadder('Jesus wept.', 1);
  assert.equal(ladderReducer(state, {type: 'key', key: ' '}), state);
  state = ladderReducer(state, {type: 'key', key: 'x'});
  assert.deepEqual([state.position, state.slips, state.typed, state.misses], [1, 0, '', [0]]);
  state = ladderReducer(state, {type: 'key', key: 'W'});
  assert.equal(state.status, 'stepDone');
  assert.equal(ladderReducer(state, {type: 'key', key: 'q'}), state);
  state = ladderReducer(state, {type: 'next'});
  assert.equal(state.step, 2);
  assert.equal(state.position, 0);
  let failed = createLadder(text, 4);
  for (const word of failed.words) failed = ladderReducer(failed, {type: 'key', key: 'z'});
  assert.equal(failed.slips, 9);
  assert.equal(ladderReducer(failed, {type: 'next'}), failed);
  assert.deepEqual(ladderReducer(failed, {type: 'restart'}), createLadder(text, 4));
});
test('shared server scoring enforces one letter per hidden word; no client indices', () => {
  assert.equal(scoreLadder(text, 1, '').accuracy, 0);
  assert.equal(scoreLadder(text, 1, '').passed, true);
  assert.equal(scoreLadder(text, 4, 'TLIMsisnw').accuracy, 100);
  assert.equal(scoreLadder(text, 4, 'xlimsisnw').passed, true);
  assert.equal(scoreLadder(text, 4, 'xximsisnw').passed, false);
  for (const typed of ['t l', '!', 'x', null, 12, 'tlimsisnw ']) {
    assert.throws(() => scoreLadder(text, 4, typed), RangeError);
  }
  assert.throws(() => scoreLadder(text, 1, 'a'), RangeError);
  assert.throws(() => scoreLadder(text, 5, ''), RangeError);
});
test('resume uses newest passed step for current wording, not a failed or old wording attempt', () => {
  const verse = {id: 1, text, reference: 'Psalm 23:1'};
  const attempt = {verse_id: 1, verse_text: text, verse_reference: verse.reference,
    mode: 'ladder', level: 2, typed: 'lms'};
  assert.equal(startingStep(verse, []), 1);
  assert.equal(startingStep(verse, [attempt]), 3);
  assert.equal(startingStep(verse, [{...attempt, level: 4, typed: 'xxxxxxxxx'}, attempt]), 3);
  assert.equal(startingStep(verse, [{...attempt, verse_text: 'old'}]), 1);
  assert.equal(startingStep(verse, [{...attempt, level: 4, typed: 'tlimsisnw'}]), 4);
});

test('typed payload includes only scored words and matches server scoring', () => {
  let state = createLadder(text, 3);
  const original = structuredClone(state);
  for (const [i, word] of state.words.entries()) {
    state = ladderReducer(state, {type: 'key', key: i === 1 ? 'z' : word[0].toUpperCase()});
  }
  assert.equal(original.position, 0);
  assert.equal(state.typed.length, state.mask.filter(Boolean).length);
  const result = scoreLadder(text, state.step, state.typed);
  assert.equal(result.passed, transition(3, state.slips, state.mask.filter(Boolean).length).passed);
  assert.equal(result.details.filter(d => d.hidden && !d.correct).length, state.slips);
  let digits = createLadder('123 words', 4);
  digits = ladderReducer(digits, {type: 'key', key: '1'});
  digits = ladderReducer(digits, {type: 'key', key: 'W'});
  assert.equal(scoreLadder(digits.text, 4, digits.typed).accuracy, 100);
});


test('accented first letters work on the ASCII pad and malformed history is skipped', () => {
  let state = createLadder('Éternel éclaire', 4);
  for (const key of ['e', 'E']) state = ladderReducer(state, {type: 'key', key});
  assert.equal(state.slips, 0);
  assert.equal(scoreLadder(state.text, 4, state.typed).accuracy, 100);
  assert.equal(scoreLadder(state.text, 4, 'Ée').accuracy, 100);
  const verse = {id: 1, text, reference: 'Psalm 23:1'};
  assert.equal(startingStep(verse, [{mode: 'ladder', verse_id: 1, verse_text: text,
    verse_reference: verse.reference, level: 4, typed: 'bad'}]), 1);
});
