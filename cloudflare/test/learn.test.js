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
test('misses never demote, Fade first tries fast-track, and only correct recall learns', () => {
  for (const word of ['a', 'to', 'cat', 'kind', 'light', 'friend', 'beautiful']) {
    const initial = newLearnWord(word, seeded(1));
    assert.equal(initial.steps.length, word.length <= 3 ? 2 : word.length <= 5 ? 3 : 4);
    assert.equal(initial.steps.at(-1).level, 100);
    assert.equal(initial.steps.filter(s => s.level === 100).length, 1);
    for (let index = 0; index < initial.steps.length; index++) {
      if (index > 0 && index < initial.steps.length - 1) {
        const fast = advanceLearn({...initial, index}, true);
        assert.equal(fast.index, initial.steps.length - 1);
        assert.equal(fast.learned, false);
      }
      const missed = advanceLearn({...initial, index}, false);
      assert.equal(missed.index, index, 'miss retries the same stage');
      assert.equal(missed.learned, false);
      const retry = advanceLearn(missed, true);
      assert.equal(retry.learned, index === initial.steps.length - 1);
      assert.equal(retry.index, Math.min(index + 1, initial.steps.length - 1), 'retry is not first-try fast track');
    }
    let state = advanceLearn(initial, true);
    assert.equal(state.index, 1, 'Copy never fast-tracks');
    assert.equal(state.learned, false);
    if (state.steps.length > 2) {
      state = advanceLearn(state, true);
      assert.equal(state.index, state.steps.length - 1, 'first-try Fade jumps to Recall');
      assert.equal(state.learned, false);
      assert.deepEqual(state.completed, [0, 1], 'skipped Fade is not completed');
    }
    const skipped = {...initial, index: initial.steps.length - 1};
    assert.equal(skipped.learned, false, 'skip is not learning credit');
    state = advanceLearn(skipped, false);
    assert.equal(state.learned, false, 'miss after skip is not learning credit');
    state = advanceLearn(state, true);
    assert.equal(state.learned, true);
    assert.deepEqual(advanceLearn(state, false), state);
  }
});
