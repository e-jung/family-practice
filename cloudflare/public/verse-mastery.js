// Shared browser/Worker policy. Attempts are newest first, as returned by storage.
// Verse: {id, text, reference}; attempt: {verse_id, verse_text, verse_reference, mode, accuracy}.
export const VERSE_MASTERY_POLICY = Object.freeze({
  recentAttempts: 10,
  oneStar: 70,
  twoStars: 95,
  advancedModes: Object.freeze(["memory", "first"]),
});

export function verseMastery(verse, attempts) {
  const policy = VERSE_MASTERY_POLICY;
  const recent = attempts.filter(attempt =>
    attempt.verse_id === verse.id &&
    attempt.verse_text === verse.text &&
    attempt.verse_reference === verse.reference,
  ).slice(0, policy.recentAttempts);
  // Read/listen counts in the history window, but never earns stars.
  const best = Math.max(0, ...recent.filter(attempt => attempt.mode !== "read").map(attempt => attempt.accuracy));
  const advanced = recent.some(attempt =>
    policy.advancedModes.includes(attempt.mode) && attempt.accuracy >= policy.twoStars,
  );
  return {
    id: verse.id,
    reference: verse.reference,
    best,
    stars: best >= policy.twoStars ? (advanced ? 3 : 2) : best >= policy.oneStar ? 1 : 0,
    attempts: recent.length,
  };
}

// Keep explanatory UI copy tied to the same thresholds as progress and email.
export function verseMasteryCopy() {
  const {oneStar, twoStars} = VERSE_MASTERY_POLICY;
  return `One star: ${oneStar}%+. Two: ${twoStars}%+. Three: ${twoStars}%+ from memory or with first-letter clues. ` +
    "Read & listen doesn’t earn stars.";
}
