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
