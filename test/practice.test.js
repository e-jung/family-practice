import test from "node:test";
import assert from "node:assert/strict";
import { checkSpelling, compareVerse, trickyWords } from "../lib/practice.js";
test("spelling ignores case and outer space but not wrong letters", () => {
  assert.equal(checkSpelling("Beautiful", "  BEAUTIFUL "), true);
  assert.equal(checkSpelling("friend", "freind"), false);
  assert.equal(checkSpelling("green", "gree n"), false);
});
test("verse comparison ignores punctuation/case and aligns omissions", () => {
  assert.equal(
    compareVerse("Thy word is a lamp.", "THY WORD is a lamp!").accuracy,
    100,
  );
  const r = compareVerse(
    "Thy word is a lamp unto my feet.",
    "Thy word a lamp unto my feet",
  );
  assert.equal(r.details.filter((d) => !d.correct).length, 1);
  assert.equal(r.details.find((d) => !d.correct).word, "is");
  assert.equal(r.accuracy, 88);
  assert.equal(compareVerse("Jesus wept.", "Jesus wept extra").accuracy, 67);
  assert.equal(
    compareVerse("For his name’s sake", "for HIS names sake!").accuracy,
    100,
  );
});
test("tricky words weight recency and misses and graduate after three first-try wins", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  let id = 0;
  const a = (word, correct, first_try = true, day = "2026-11-13") => ({
    id: ++id,
    word,
    correct: +correct,
    first_try: +first_try,
    created_at: day + "T10:00:00Z",
    word_id: id,
    list_id: 1,
  });
  const attempts = [
    a("old", false, true, "2026-10-01"),
    a("new", false),
    a("done", false),
    a("done", true),
    a("DONE", true),
    a("done", true),
    a("retry", false),
    a("retry", true, false),
    a("retry", true),
    a("retry", true),
  ];
  let r = trickyWords(attempts, now);
  assert.equal(r[0].word, "new");
  assert.equal(
    r.some((w) => w.word === "done"),
    false,
  );
  assert.equal(r.find((w) => w.word === "retry").streak, 2);
  r = trickyWords([...attempts, a("done", false)], now);
  assert.equal(
    r.some((w) => w.word === "done"),
    true,
  );
});
