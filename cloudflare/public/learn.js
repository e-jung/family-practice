// Copy–Cover–Compare with progressively vanishing cues. No learner data here.
export function fadeSteps(word, random = Math.random) {
  const letters = Array.from(word);
  if (letters.length <= 3) return [
    { level: 0, cue: word }, { level: 100, cue: letters.map(() => '_').join(' ') },
  ];
  const order = letters.map((_, i) => i).slice(1);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return [0, 25, 50, 75, 100].map(level => {
    const hidden = new Set(level === 100 ? [...order, 0] : order.slice(0, Math.min(order.length, Math.ceil(letters.length * level / 100))));
    return {level, cue: letters.map((letter, i) => hidden.has(i) ? '_' : letter).join(' ')};
  });
}
export function newLearnWord(word, random = Math.random) {
  return {steps: fadeSteps(word, random), index: 0, learned: false, comparisons: 0};
}
export function advanceLearn(state, correct) {
  if (state.learned) return state;
  if (!correct) return {...state, index: Math.max(0, state.index - 1), comparisons: state.comparisons + 1};
  if (state.index === state.steps.length - 1) return {...state, learned: true};
  return {...state, index: state.index + 1};
}
