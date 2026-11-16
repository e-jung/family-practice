// Pure round lifecycle. Subjects supply only their answer/retry policy; edges own I/O.
const subjects = Object.freeze({spelling: Object.freeze({retry: true})});
export function newRound(ws, metadata = {}, subject = 'spelling') {
  if (!subjects[subject]) throw Error('Unknown practice subject');
  return {...metadata, subject, ws: [...ws], phase: ws.length ? 'answer' : 'complete',
    index: 0, first: 0, misses: [], results: []};
}
export const roundDone = state => ['success', 'reveal'].includes(state.phase);
export const roundBusy = state => ['checking', 'checking-retry'].includes(state.phase);
export function reduce(state, event) {
  if (!event || typeof event.type !== 'string') return state;
  const phase = state.phase;
  if (event.type === 'QUIT' && !['complete', 'quit'].includes(phase)) return {...state, phase: 'quit'};
  if (event.type === 'SUBMIT' && ['answer', 'retry'].includes(phase)) {
    return {...state, phase: phase === 'retry' ? 'checking-retry' : 'checking'};
  }
  if (event.type === 'ERROR' && roundBusy(state)) {
    return {...state, phase: phase === 'checking-retry' ? 'retry' : 'answer'};
  }
  if (event.type === 'RESULT' && roundBusy(state) && typeof event.correct === 'boolean') {
    const retry = phase === 'checking-retry';
    const correct = event.correct;
    const reveal = retry || !subjects[state.subject].retry;
    const results = [...state.results];
    if (correct || reveal) results[state.index] = correct && !retry ? 'done' : 'miss';
    return {...state, results, phase: correct ? 'success' : reveal ? 'reveal' : 'retry',
      first: state.first + (correct && !retry ? 1 : 0),
      misses: !correct && !retry ? [...state.misses, state.ws[state.index]] : state.misses};
  }
  if (event.type === 'NEXT' && roundDone(state)) {
    return {...state, index: state.index + 1,
      phase: state.index + 1 === state.ws.length ? 'complete' : 'answer'};
  }
  // Reserved for a future subject's skip control; spelling has no skip UI.
  if (event.type === 'SKIP' && ['answer', 'retry'].includes(phase)) {
    const results = [...state.results];
    results[state.index] = 'miss';
    return {...state, results, phase: 'reveal',
      misses: phase === 'answer' ? [...state.misses, state.ws[state.index]] : state.misses};
  }
  return state;
}
