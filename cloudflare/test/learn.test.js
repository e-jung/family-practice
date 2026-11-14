import test from 'node:test';
import assert from 'node:assert/strict';
import {fadeSteps, newLearnWord, advanceLearn} from '../public/learn.js';
const seeded = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
test('fade cues are deterministic, nested, preserve first letter until audio-only', () => {
  const steps = fadeSteps('friend', seeded(42));
  assert.deepEqual(steps, fadeSteps('friend', seeded(42)));
  assert.deepEqual(steps.map(s => s.level), [0,50,75,100]);
  let prior = [];
  for (const step of steps) {
    const chars = step.cue.split(' '), hidden = chars.flatMap((c,i) => c === '_' ? [i] : []);
    assert.ok(prior.every(i => hidden.includes(i)));
    assert.equal(chars[0], step.level === 100 ? '_' : 'f');
    prior = hidden;
  }
  assert.equal(prior.length, 6);
});
test('short words use copy then fully blank, including Unicode letters', () => {
  for (const word of ['a','to','cat','é🙂']) {
    const steps = fadeSteps(word, seeded(1));
    assert.deepEqual(steps.map(s => s.level), [0,100]);
    assert.equal(steps[0].cue, word);
    assert.equal(steps[1].cue.split(' ').length, Array.from(word).length);
  }
});
test('learn requires a correct audio-only attempt and compares one easier clue after errors', () => {
  let state = newLearnWord('friend', seeded(1));
  state = advanceLearn(state, false);
  assert.equal(state.index, 0);
  assert.equal(state.comparisons, 1);
  state = advanceLearn(advanceLearn(state, true), true);
  assert.equal(state.index, 2);
  assert.deepEqual(state.completed, [0,1]);
  state = advanceLearn(state, false);
  assert.equal(state.index, 1);
  assert.equal(state.learned, false);
  for (let i=0; i<2; i++) state = advanceLearn(state, true);
  assert.equal(state.index, 3);
  assert.equal(state.learned, false);
  state = advanceLearn(state, true);
  assert.equal(state.learned, true);
  assert.deepEqual(advanceLearn(state, false), state);
});
