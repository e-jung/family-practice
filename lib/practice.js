import {defaults} from '../cloudflare/settings.js';

export const normalize = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .trim();
export const checkSpelling = (expected, typed) =>
  normalize(expected) === normalize(typed);
export const words = (s) =>
  normalize(s)
    .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)
    ?.map((w) => w.replace(/['’]/g, "")) || [];
// Alignment keeps a single omitted/extra word from making the entire remainder wrong.
export function compareVerse(expected, typed) {
  const a = words(expected),
    b = words(typed),
    d = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  let i = a.length,
    j = b.length,
    details = [];
  while (i || j) {
    if (
      i &&
      j &&
      d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
    ) {
      details.unshift({
        word: a[i - 1],
        typed: b[j - 1],
        correct: a[i - 1] === b[j - 1],
      });
      i--;
      j--;
    } else if (i && d[i][j] === d[i - 1][j] + 1) {
      details.unshift({ word: a[i - 1], typed: "", correct: false });
      i--;
    } else {
      details.unshift({ word: "", typed: b[j - 1], correct: false });
      j--;
    }
  }
  return {
    accuracy: Math.round(
      100 *
        Math.max(
          0,
          1 - d[a.length][b.length] / Math.max(a.length, b.length, 1),
        ),
    ),
    details,
  };
}
export function trickyWords(attempts, now = Date.now()) {
  const groups = new Map();
  for (const a of [...attempts].sort((a, b) => a.id - b.id)) {
    const key = normalize(a.word);
    let g = groups.get(key) || {
      word: a.word,
      sentence: a.sentence || "",
      misses: 0,
      streak: 0,
      lastMiss: 0,
      word_id: a.word_id,
      list_id: a.list_id,
    };
    g.word_id = a.word_id;
    g.list_id = a.list_id;
    if (!a.correct) {
      g.misses++;
      g.streak = 0;
      g.lastMiss = Date.parse(a.created_at);
    } else if (a.first_try) g.streak++;
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.misses && g.streak < 3)
    .map((g) => ({
      ...g,
      weight: g.misses + 10 / (1 + Math.max(0, (now - g.lastMiss) / 86400000)),
    }))
    .sort((a, b) => b.weight - a.weight);
}

// Leitner scheduling uses calendar days, never a rolling local-time 24 hours.
export const REVIEW_INTERVALS = Object.freeze([1, 2, 4, 7, 14, 30]);
export const utcDay = (value = Date.now()) => new Date(value).toISOString().slice(0, 10);
export function scheduleWord(previous, attempt, now = attempt.created_at ?? Date.now()) {
  if (attempt.step === 'skip') return previous;
  const learn = attempt.mode === 'learn';
  if (learn && previous?.tested) return previous;
  const day = utcDay(now);
  const current = previous ?? {key: normalize(attempt.word), box: 1, misses: 0, seen: 0, first_try_correct: 0, tested: false};
  // Cued practice introduces a word, but is not evidence of recall.
  if (learn && attempt.step !== 100) {
    if (previous) return previous;
    const due = new Date(day + 'T00:00:00Z'); due.setUTCDate(due.getUTCDate() + 1);
    return {...current, word: attempt.word, sentence: attempt.sentence || '', word_id: attempt.word_id,
      list_id: attempt.list_id, last_practiced: day, due: utcDay(due), last_result: 'learning'};
  }
  const correct = Boolean(attempt.correct), first = Boolean(attempt.first_try);
  const box = !correct ? 1 : first ? (learn ? 2 : Math.min(6, current.box + 1)) : current.box;
  const due = new Date(day + 'T00:00:00.000Z');
  due.setUTCDate(due.getUTCDate() + REVIEW_INTERVALS[box - 1]);
  return {...current, word: attempt.word, sentence: attempt.sentence ?? current.sentence ?? '', word_id: attempt.word_id, list_id: attempt.list_id,
    box, misses: current.misses + Number(!correct), seen: (current.seen || 0) + 1,
    first_try_correct: (current.first_try_correct || 0) + Number(correct && first),
    last_result: correct ? first ? 'first_try_correct' : 'retry_correct' : 'miss',
    tested: current.tested || !learn, last_practiced: day, due: utcDay(due)};
}
export function reviewBank(entries, now = Date.now(), batchSize = defaults.reviewBatch) {
  const day = utcDay(now), soon = new Date(day + 'T00:00:00.000Z');
  soon.setUTCDate(soon.getUTCDate() + 7);
  const byPriority = (a,b) => a.box-b.box || b.misses-a.misses || a.due.localeCompare(b.due) || a.key.localeCompare(b.key);
  const words = [...entries].sort(byPriority);
  const future = words.filter(w => w.due > day).sort((a,b) => a.due.localeCompare(b.due) || byPriority(a,b));
  const due = words.filter(w => w.due <= day);
  return {due: due.slice(0,batchSize), dueCount: due.length, nextDue: future[0]?.due ?? null,
    counts: {learning: words.filter(w=>w.box<=2).length, gettingIt: words.filter(w=>w.box>=3 && w.box<=4).length, mastered: words.filter(w=>w.box>=5).length},
    struggling: words.filter(w=>w.misses>=2 && w.box===1), dueSoon: future.filter(w=>w.due<=utcDay(soon)), words};
}
