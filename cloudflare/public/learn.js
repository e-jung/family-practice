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
  return (letters.length <= 5 ? [0, 50, 100] : [0, 50, 75, 100]).map(level => {
    const hidden = new Set(level === 100 ? [...order, 0] : order.slice(0, Math.min(order.length, Math.ceil(letters.length * level / 100))));
    return {level, cue: letters.map((letter, i) => hidden.has(i) ? '_' : letter).join(' ')};
  });
}
export function newLearnWord(word, random = Math.random) {
  return {steps: fadeSteps(word, random), index: 0, completed: [], learned: false, comparisons: 0, missed: []};
}
export function advanceLearn(state, correct) {
  if (state.learned) return state;
  if (!correct) return {...state, missed: [...new Set([...(state.missed || []), state.index])], comparisons: state.comparisons + 1};
  const completed = [...new Set([...(state.completed || []), state.index])];
  if (state.index === state.steps.length - 1) return {...state, completed, learned: true};
  const fastTrack = state.steps[state.index].level > 0 && !(state.missed || []).includes(state.index);
  return {...state, completed, index: fastTrack ? state.steps.length - 1 : state.index + 1};
}
