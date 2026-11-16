import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyFixture} from '../fixture-support.js';
import {verseMastery} from '../public/verse-mastery.js';

// Exercise both real handlers over the same SQLite rows, not source-string assertions or SQL stubs.
test('progress and digest share current-wording, score, mode and rolling-history mastery', async t => {
  const f = emptyFixture(t);
  assert.equal((await f.req('/api/families', {name: 'Policy tests', pin: '5678'})).status, 201);
  assert.equal((await f.req('/api/admin/kids', {name: 'Alex'})).status, 200);
  const oldDate = new Date(Date.now() - 8 * 86400000).toISOString();
  const recentDate = new Date(Date.now() - 86400000).toISOString();
  f.db.prepare('INSERT INTO sessions(id,kid_id,kind,created_at) VALUES(?,?,?,?)').run('verse-test', 1, 'verse', oldDate);
  const insert = f.db.prepare(`INSERT INTO verse_attempts
    (kid_id,verse_id,mode,level,typed,accuracy,created_at,session_id,verse_text,verse_reference)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const scenarios = [
    {mode: 'blanks', accuracy: 69, stars: 0},
    {mode: 'blanks', accuracy: 70, stars: 1},
    {mode: 'blanks', accuracy: 94, stars: 1},
    {mode: 'blanks', accuracy: 95, stars: 2},
    {mode: 'first', accuracy: 95, stars: 3},
    {mode: 'memory', accuracy: 95, stars: 3},
    {mode: 'read', accuracy: 100, stars: 0},
    {mode: 'read', accuracy: 100, stars: 0, expire: true},
  ];
  let expectedBefore = 0;
  for (const [i, scenario] of scenarios.entries()) {
    const verse = {kid_id: 1, reference: `Reference ${i}`, text: 'Jesus wept.'};
    const created = await f.req('/api/admin/verses', verse);
    assert.equal(created.status, 201);
    const id = created.body.id;
    const add = (mode, accuracy, date, text = verse.text, reference = verse.reference) =>
      insert.run(1, id, mode, 0, '', accuracy, date, 'verse-test', text, reference);
    // Digest's week-start baseline must also use the policy and current wording.
    if (scenario.expire) { add('memory', 100, oldDate); expectedBefore += 3; }
    else add('blanks', 0, oldDate);
    for (let n = 0; n < (scenario.expire ? 10 : 1); n++) add(scenario.mode, scenario.accuracy, recentDate);
    // Newer attempts for changed wording/reference must not displace qualifying history.
    for (let n = 0; n < 11; n++) {
      add('memory', 100, recentDate, 'Different wording.');
      add('memory', 100, recentDate, verse.text, 'Different reference');
    }
  }
  const progress = await f.req('/api/progress?kid=1');
  assert.equal(progress.status, 200);
  assert.deepEqual(progress.body.mastery.map(v => v.stars), scenarios.map(s => s.stars));
  const rows = f.db.prepare('SELECT * FROM verse_attempts ORDER BY id DESC').all();
  const verses = f.db.prepare('SELECT * FROM verses ORDER BY id').all();
  assert.deepEqual(progress.body.mastery, verses.map(v => verseMastery(v, rows)));
  const family = [...f.databases.entries()].find(([name]) => name.startsWith('fam:'))[1].object;
  const response = await family.fetch(new Request('https://internal/api/internal/account/digest', {
    method: 'POST', body: '{}',
  }));
  assert.equal(response.status, 200);
  const digest = await response.json();
  assert.equal(digest.kids[0].verseStarsChange, scenarios.reduce((sum, s) => sum + s.stars, 0) - expectedBefore);
  assert.equal(digest.kids[0].verseStarsChange,
    progress.body.mastery.reduce((sum, v) => sum + v.stars, 0) - expectedBefore);
});
