// Pure shared browser/Worker rules. Frozen here because settings are Worker-only:
// a cached shell and the scoring edge must use the same mask and thresholds.
export const LADDER_RULES = Object.freeze({
  fractions: Object.freeze([0, 1 / 3, 2 / 3, 1]),
  smallPassageWords: 10,
  smallPassageAllowance: 1,
  allowedFraction: 0.1,
});
export function tokenize(text) {
  return text.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[’'ʼ‐‑-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu) || [];
}
function validStep(step) {
  if (!Number.isInteger(step) || step < 1 || step > 4) throw new RangeError('Invalid ladder step');
}
// Incord's spread: longest word in each evenly sized bin; ties favour its centre.
function spread(words, amount, mask) {
  const available = words.map((_, i) => i).filter(i => !mask[i]);
  for (let bin = 0; bin < amount; bin++) {
    const start = Math.floor(bin * available.length / amount);
    const end = Math.floor((bin + 1) * available.length / amount);
    const center = (start + end - 1) / 2;
    let selected = start;
    for (let j = start + 1; j < end; j++) {
      const length = words[available[j]].length, best = words[available[selected]].length;
      if (length > best || (length === best && Math.abs(j - center) < Math.abs(selected - center))) selected = j;
    }
    mask[available[selected]] = true;
  }
}
export function maskWords(text, step) {
  validStep(step);
  const words = tokenize(text), mask = words.map(() => step === 4);
  if (step === 1 || step === 4 || !words.length) return mask;
  const target = s => Math.max(1, Math.round(words.length * LADDER_RULES.fractions[s - 1]));
  spread(words, target(2), mask);
  if (step === 3) spread(words, target(3) - target(2), mask);
  return mask;
}
export function allowance(hidden) {
  if (!Number.isSafeInteger(hidden) || hidden < 0) throw new RangeError('Invalid hidden count');
  return hidden <= LADDER_RULES.smallPassageWords
    ? LADDER_RULES.smallPassageAllowance : Math.floor(hidden * LADDER_RULES.allowedFraction);
}
export function transition(step, slips, hidden) {
  validStep(step);
  if (!Number.isSafeInteger(slips) || slips < 0 || slips > hidden) throw new RangeError('Invalid slips');
  const passed = step === 1 || slips <= allowance(hidden);
  return {step: passed ? Math.min(4, step + 1) : step, learned: passed && step === 4, passed};
}
export const isLetterKey = key => typeof key === 'string' && /^[\p{L}\p{N}]$/u.test(key);
export const firstLetter = word => Array.from(word.normalize('NFD').replace(/\p{M}/gu, ''))[0]
  .toLocaleLowerCase('en-US');
export function scoreLadder(text, step, typed) {
  const words = tokenize(text), mask = maskWords(text, step);
  const keys = typeof typed === 'string' ? Array.from(typed) : [];
  const hidden = mask.filter(Boolean).length;
  if (typeof typed !== 'string' || keys.length !== hidden || keys.some(key => !isLetterKey(key))) {
    throw new RangeError('Invalid ladder letters');
  }
  let index = 0, correct = 0;
  const details = words.map((word, i) => {
    const key = mask[i] ? keys[index++] : '';
    const matched = !mask[i] || firstLetter(word) === firstLetter(key);
    if (mask[i] && matched) correct++;
    return {word, typed: key, hidden: mask[i], correct: matched};
  });
  return {accuracy: hidden ? Math.round(100 * correct / hidden) : 0, details,
    passed: transition(step, hidden - correct, hidden).passed};
}
// State: typing -> stepDone. Visible words are typed along but never scored.
export function createLadder(text, step = 1) {
  const words = tokenize(text), mask = maskWords(text, step);
  return {text, step, words, mask, position: 0, typed: '', misses: [], slips: 0,
    status: words.length ? 'typing' : 'stepDone'};
}
export function ladderReducer(state, event) {
  if (event.type === 'restart') return createLadder(state.text, state.step);
  if (event.type === 'next' && state.status === 'stepDone') {
    const outcome = transition(state.step, state.slips, state.mask.filter(Boolean).length);
    return outcome.passed ? createLadder(state.text, outcome.step) : state;
  }
  if (event.type !== 'key' || state.status !== 'typing' || !isLetterKey(event.key)) return state;
  const i = state.position, wrong = firstLetter(state.words[i]) !== firstLetter(event.key);
  return {...state, position: i + 1,
    typed: state.typed + (state.mask[i] ? event.key : ''),
    misses: wrong ? [...state.misses, i] : state.misses,
    slips: state.slips + (state.mask[i] && wrong ? 1 : 0),
    status: i + 1 === state.words.length ? 'stepDone' : 'typing'};
}
// Attempts arrive newest first; only the current wording/reference can advance it.
export function startingStep(verse, attempts) {
  const latest = attempts.find(a => {
    if (a.mode !== 'ladder' || a.verse_id !== verse.id || a.verse_text !== verse.text ||
      a.verse_reference !== verse.reference || !Number.isInteger(a.level) || a.level < 1 || a.level > 4) return false;
    // Old/imported history must not make the whole progress endpoint unavailable.
    try { return scoreLadder(verse.text, a.level, a.typed).passed; } catch { return false; }
  });
  return latest ? Math.min(4, latest.level + 1) : 1;
}
