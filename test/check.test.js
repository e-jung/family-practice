import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, copyFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {measure, regressions, scan, shrink} from '../scripts/check.mjs';

test('source gate rejects new oversized files and long lines', () => {
  const oversized = measure('x\n'.repeat(1001));
  assert.match(regressions({'new.js': oversized}, {files: {}}).join('\n'), /lines debt 1001/);
  const long = measure('x'.repeat(161));
  assert.match(regressions({'new.js': long}, {files: {}}).join('\n'), /longLines debt 1/);
  assert.deepEqual(regressions({'ok.js': measure(`${'x'.repeat(160)}\n`.repeat(1000))}, {}), []);
});

test('baseline shrinks and never grants a new offender or worsening metric', () => {
  const old = {'old.js': measure(`${'x'.repeat(200)}\n`.repeat(1002))};
  const baseline = shrink(old);
  assert.deepEqual(regressions(old, baseline), []);
  assert.ok(regressions({'old.js': measure(`${'x'.repeat(201)}\n`.repeat(1002))}, baseline).length);
  assert.ok(regressions({'new.js': old['old.js']}, baseline).length);
  const improved = {'old.js': measure('x'.repeat(170))};
  assert.deepEqual(regressions(improved, baseline), []);
  const reduced = shrink(improved);
  assert.ok(regressions(old, reduced).length);
  assert.deepEqual(shrink({'old.js': measure('ok\n')}).files, {});
});

test('source scan includes untracked source but excludes assets, tools and goldens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spellami-check-'));
  try {
    for (const name of ['assets', '.tools', '.wrangler', 'node_modules', 'goldens']) {
      await mkdir(join(root, name));
      await writeFile(join(root, name, 'ignored.js'), 'x'.repeat(500));
    }
    await writeFile(join(root, 'new.js'), 'x'.repeat(161));
    await writeFile(join(root, 'notes.md'), 'x'.repeat(500));
    const metrics = await scan(root);
    assert.deepEqual(Object.keys(metrics), ['new.js']);
    assert.ok(regressions(metrics, {}).length);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});


test('CLI fails oversized and long-line fixtures without expanding the baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spellami-gate-cli-'));
  try {
    await mkdir(join(root, 'scripts'));
    await copyFile(new URL('../scripts/check.mjs', import.meta.url), join(root, 'scripts/check.mjs'));
    const baseline = JSON.stringify(shrink({}));
    await writeFile(join(root, 'scripts/check-baseline.json'), baseline);
    for (const source of ['x\n'.repeat(1001), 'x'.repeat(161)]) {
      await writeFile(join(root, 'fixture.js'), source);
      const result = spawnSync(process.execPath, ['scripts/check.mjs', '--update-baseline'], {
        cwd: root, encoding: 'utf8',
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Source gate failed/);
      assert.match(result.stderr, /fixture\.js/);
      assert.equal(await readFile(join(root, 'scripts/check-baseline.json'), 'utf8'), baseline);
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
