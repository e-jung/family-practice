import test from 'node:test';
import assert from 'node:assert/strict';
import {newRound, reduce, roundDone, roundBusy} from '../cloudflare/public/practice-round.js';
const words = [{id: 1, word: 'one'}, {id: 2, word: 'two'}];
const answer = (s, correct) => reduce(reduce(s, {type: 'SUBMIT'}), {type: 'RESULT', correct});
test('normal spelling round credits first tries and completes', () => {
  let s = newRound(words);
  const initial = structuredClone(s);
  s = answer(s, true);
  assert.equal(s.first, 1);
  assert.ok(roundDone(s));
  assert.deepEqual(s.results, ['done']);
  s = reduce(s, {type: 'NEXT'});
  assert.equal(s.index, 1);
  assert.equal(s.phase, 'answer');
  s = reduce(answer(s, true), {type: 'NEXT'});
  assert.equal(s.phase, 'complete');
  assert.equal(s.first, 2);
  assert.deepEqual(newRound(words), initial);
});
test('one retry preserves first-try miss even on later success', () => {
  let s = answer(newRound(words), false);
  assert.equal(s.phase, 'retry');
  assert.deepEqual(s.misses, [words[0]]);
  s = answer(s, true);
  assert.equal(s.phase, 'success');
  assert.equal(s.first, 0);
  assert.deepEqual(s.results, ['miss']);
  assert.deepEqual(s.misses, [words[0]]);
});
test('second miss reveals; next begins a fresh first try', () => {
  let s = answer(answer(newRound(words), false), false);
  assert.equal(s.phase, 'reveal');
  s = answer(reduce(s, {type: 'NEXT'}), true);
  assert.equal(s.first, 1);
  assert.deepEqual(s.results, ['miss', 'done']);
});
test('API errors restore the same try without credit; duplicate submission is ignored', () => {
  for (const s of [newRound(words), answer(newRound(words), false)]) {
    const busy = reduce(s, {type: 'SUBMIT'});
    assert.ok(roundBusy(busy));
    assert.equal(reduce(busy, {type: 'SUBMIT'}), busy);
    assert.deepEqual(reduce(busy, {type: 'ERROR'}), s);
  }
});
test('skip and quit never credit success; terminal events are ignored', () => {
  const s = reduce(newRound(words), {type: 'SKIP'});
  assert.equal(s.phase, 'reveal');
  assert.equal(s.first, 0);
  assert.deepEqual(s.misses, [words[0]]);
  const quit = reduce(s, {type: 'QUIT'});
  for (const type of ['NEXT', 'SUBMIT', 'RESULT', 'SKIP', 'QUIT']) assert.equal(reduce(quit, {type}), quit);
});
test('review and missed-word rounds use the same lifecycle, not previous scores', () => {
  const s = answer(newRound(words, {kind: 'review', session: 10}), false);
  const next = newRound(s.misses, {kind: s.kind, session: 11});
  assert.equal(next.kind, 'review');
  assert.equal(next.first, 0);
  assert.deepEqual(next.results, []);
  assert.deepEqual(next.ws, [words[0]]);
  assert.equal(answer(next, true).first, 1);
});
test('invalid or out-of-order events are ignored without throwing', () => {
  const s = newRound(words);
  for (const event of [null, {}, {type: 'bogus'}, {type: 'RESULT', correct: true}, {type: 'NEXT'}]) {
    assert.equal(reduce(s, event), s);
  }
  const busy = reduce(s, {type: 'SUBMIT'});
  assert.equal(reduce(busy, {type: 'RESULT', correct: 'yes'}), busy);
  assert.equal(newRound([]).phase, 'complete');
});
