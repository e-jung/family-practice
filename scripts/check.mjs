import {readFile, readdir, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const LIMITS = Object.freeze({lines: 1000, lineLength: 160});
const excluded = new Set(['.git', '.impeccable', 'assets', '.tools', '.wrangler', 'node_modules', 'goldens']);
const extensions = new Set(['.js', '.mjs', '.css', '.html']);
const baselinePath = 'scripts/check-baseline.json';

// Metrics describe only existing debt, not an exemption for the whole file.
export function measure(source) {
  const lines = source === '' ? [] : source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const lengths = lines.map(line => [...line].length);
  return {
    lines: lines.length,
    longLines: lengths.filter(length => length > LIMITS.lineLength).length,
    maxLength: Math.max(0, ...lengths),
    excessCharacters: lengths.reduce((sum, length) => sum + Math.max(0, length - LIMITS.lineLength), 0),
  };
}

export async function scan(root) {
  const metrics = {};
  async function visit(relative = '') {
    const entries = await readdir(join(root, relative), {withFileTypes: true});
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (excluded.has(entry.name)) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(name);
      if (!entry.isFile() || !extensions.has(extname(name)) || name === baselinePath) continue;
      metrics[name] = measure(await readFile(join(root, name), 'utf8'));
    }
  }
  await visit();
  return metrics;
}

export function regressions(metrics, baseline) {
  const errors = [];
  for (const [name, current] of Object.entries(metrics)) {
    for (const [metric, value] of Object.entries(current)) {
      const floor = metric === 'lines' ? LIMITS.lines : metric === 'maxLength' ? LIMITS.lineLength : 0;
      const allowed = Math.max(floor, baseline.files?.[name]?.[metric] ?? 0);
      if (value > allowed) errors.push(`${name}: ${metric} debt ${value} exceeds baseline ${allowed}`);
    }
  }
  return errors;
}

export function shrink(metrics) {
  return {
    version: 1,
    limits: LIMITS,
    files: Object.fromEntries(Object.entries(metrics).filter(([, values]) => (values.lines > LIMITS.lines || values.longLines > 0))),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--update-baseline')) throw Error('Usage: node scripts/check.mjs [--update-baseline]');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const baseline = JSON.parse(await readFile(join(root, baselinePath), 'utf8'));
  if (baseline.version !== 1 || JSON.stringify(baseline.limits) !== JSON.stringify(LIMITS)) {
    throw Error('Baseline version/limits mismatch; do not loosen readability limits.');
  }
  const metrics = await scan(root);
  const errors = regressions(metrics, baseline);
  if (errors.length) throw Error(`Source gate failed:\n${errors.join('\n')}`);
  for (const [name, prior] of Object.entries(baseline.files || {})) {
    const current = metrics[name];
    if (!current || Object.keys(prior).some(metric => current[metric] < prior[metric])) {
      console.log(`Baseline improved: ${name}; tighten/remove with node scripts/check.mjs --update-baseline.`);
    }
  }
  if (args.includes('--update-baseline')) {
    await writeFile(join(root, baselinePath), `${JSON.stringify(shrink(metrics), null, 2)}\n`);
  }
  console.log(`Source gate passed (${Object.keys(metrics).length} files; ${Object.keys(shrink(metrics).files).length} existing offenders).`);
  const result = spawnSync(process.execPath, ['--test'], {cwd: root, stdio: 'inherit'});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
