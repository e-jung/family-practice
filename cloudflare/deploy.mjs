#!/usr/bin/env node
// Node 24 only; no Wrangler, SDK, package installation, or import-time network I/O.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.cloudflare.com/client/v4';
export const SCRIPT = 'family-practice';
export const MODULES = ['cloudflare/worker.js', 'cloudflare/core.js', 'cloudflare/auth.js', 'cloudflare/tts.js', 'lib/practice.js'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
};

export async function buildPlan(root = ROOT) {
  const manifest = Object.create(null);
  const files = new Map();
  const config = { run_worker_first: true };
  async function walk(relative = '') {
    const entries = (await readdir(join(root, 'cloudflare/public', relative), { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Refusing public symlink: ${name}`);
      if (entry.isDirectory()) { await walk(name); continue; }
      if (!entry.isFile()) throw new Error(`Not a regular public file: ${name}`);
      const bytes = await readFile(join(root, 'cloudflare/public', name));
      if (name === '_headers' || name === '_redirects') {
        config[name] = bytes.toString('utf8'); // Configuration, never a downloadable asset.
        continue;
      }
      if (bytes.length > 25 * 1024 * 1024) throw new Error(`Asset exceeds 25 MiB: ${name}`);
      // Same 32-hex hash recipe as Cloudflare's direct-upload example (extension affects MIME).
      const hash = createHash('sha256').update(bytes.toString('base64') + extname(name).slice(1)).digest('hex').slice(0, 32);
      manifest[`/${name}`] = { hash, size: bytes.length };
      const type = MIME[extname(name).toLowerCase()] || 'application/octet-stream';
      const prior = files.get(hash);
      if (prior && (!prior.bytes.equals(bytes) || prior.type !== type)) throw new Error(`Asset hash/type collision: ${name}`);
      files.set(hash, { bytes, type });
    }
  }
  await walk();
  const count = Object.keys(manifest).length;
  if (!count || count > 20000) throw new Error('Expected 1–20,000 static assets (Workers Free limit)');
  const modules = await Promise.all(MODULES.map(async name => ({ name, bytes: await readFile(join(root, name)) })));
  return { manifest, files, modules, config };
}

export function metadataFor(plan, jwt, migrationTag) {
  if (migrationTag != null && migrationTag !== '' && !['v1', 'v2'].includes(migrationTag)) {
    throw new Error('Unexpected Durable Object migration tag; refusing to change migration history');
  }
  return {
    main_module: 'cloudflare/worker.js',
    compatibility_date: '2026-11-01',
    observability: { enabled: true, head_sampling_rate: 1 },
    bindings: [
      { name: 'FAMILY', type: 'durable_object_namespace', class_name: 'FamilyDatabase' },
      { name: 'REGISTRY', type: 'durable_object_namespace', class_name: 'RegistryLimits' },
      { name: 'TTS_CACHE', type: 'durable_object_namespace', class_name: 'TtsCache' },
      { name: 'ASSETS', type: 'assets' },
      { name: 'AI', type: 'ai' },
    ],
    keep_bindings: ['secret_text'],
    assets: { jwt, config: plan.config },
    ...(migrationTag === 'v2' ? {} : { migrations: { old_tag: migrationTag || '', new_tag: 'v2', steps: [...(migrationTag === 'v1' ? [] : [{ new_sqlite_classes: ['FamilyDatabase', 'RegistryLimits'] }]), { new_sqlite_classes: ['TtsCache'] }] } }),
  };
}

export async function deploy({ env = process.env, fetchImpl = globalThis.fetch, root = ROOT, dryRun = false, log = console.log } = {}) {
  const plan = await buildPlan(root);
  if (dryRun) {
    const summary = {
      dry_run: true, script: SCRIPT, network_requests: 0,
      modules: plan.modules.map(({ name, bytes }) => ({ name, size: bytes.length })),
      manifest: plan.manifest,
      metadata_if_first_deployment: metadataFor(plan, '<completion JWT: obtained only during deployment>', null),
      metadata_if_live_v1: metadataFor(plan, '<completion JWT: obtained only during deployment>', 'v1'),
      migration_check: 'Live deployment reads current settings; v1 applies v2; v2 omits migrations; unknown tags abort.',
      secrets: ['SESSION_SECRET', 'IP_HASH_SALT'],
      optional_secrets: ['OPS_TOKEN'],
      ops_warning: 'Without OPS_TOKEN, /api/ops/stats returns 404. Omitted OPS_TOKEN preserves any deployed value.',
      routes: 'unchanged; no routes, domains, workers.dev, or Access configuration is created',
    };
    log(JSON.stringify(summary, null, 2));
    return summary;
  }
  for (const name of ['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'SESSION_SECRET', 'IP_HASH_SALT']) {
    if (!env[name]) throw new Error(`Missing environment variable: ${name}`);
  }
  if (!/^[a-f0-9]{32}$/i.test(env.CF_ACCOUNT_ID)) throw new Error('CF_ACCOUNT_ID must be a 32-character hexadecimal account ID');
  if (env.IP_HASH_SALT.length < 32) throw new Error('IP_HASH_SALT must contain at least 32 characters');
  if (env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  if (!env.OPS_TOKEN) log('Warning: OPS_TOKEN not supplied; ops stats stays disabled on a new deployment; any existing token is retained.');
  const accountPath = `/accounts/${env.CF_ACCOUNT_ID}/workers`;
  const scriptPath = `${accountPath}/scripts/${SCRIPT}`;
  async function api(path, { method = 'GET', body, token = env.CF_API_TOKEN, allow404 = false } = {}) {
    const headers = { Authorization: `Bearer ${token}` };
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetchImpl(`${API}${path}`, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(120000) });
    } catch {
      throw new Error(`Cloudflare ${method} request failed (${path.endsWith('/secrets') ? 'secret update' : 'deployment step'}); state may have changed, inspect before rerunning`);
    }
    if (allow404 && (response.status === 404 || (allow404 === 'or403' && response.status === 403))) return null;
    let payload;
    try { payload = await response.json(); } catch { throw new Error(`Cloudflare returned non-JSON (HTTP ${response.status})`); }
    if (!response.ok || payload.success !== true) {
      // Do not echo response bodies, request bodies, credentials, or upload JWTs.
      const codes = (Array.isArray(payload.errors) ? payload.errors : []).map(e => Number(e.code)).filter(Number.isFinite);
      const msgs = (Array.isArray(payload.errors) ? payload.errors : []).map(e => String(e.message || '').slice(0, 200)).join(' | ');
      throw new Error(`Cloudflare ${method} failed (HTTP ${response.status}; error codes: ${codes.join(', ') || 'none'}${msgs ? '; ' + msgs : ''})`);
    }
    return payload.result;
  }

  // Legacy version settings include migration_tag. Current /script-settings docs describe
  // a different script-level resource, so never infer "unmigrated" from an omitted field.
  const settings = await api(`${scriptPath}/settings`, { allow404: 'or403' });
  let migrationTag = settings?.migration_tag;
  if (migrationTag === undefined) {
    const scripts = await api(`${accountPath}/scripts`);
    if (!Array.isArray(scripts)) throw new Error('Unexpected Workers list response; migration state unknown');
    const existing = scripts.find(script => script.id === SCRIPT);
    migrationTag = existing?.migration_tag ?? null;
    // Missing tags are documented for Workers that do not use Durable Objects.
    if (settings === null && existing) log('Using documented Workers list migration state (legacy settings unavailable).');
  }
  metadataFor(plan, '', migrationTag); // Validate migration before any write.
  const session = await api(`${scriptPath}/assets-upload-session`, { method: 'POST', body: { manifest: plan.manifest } });
  if (!session?.jwt || !Array.isArray(session.buckets)) throw new Error('Invalid assets upload session response');
  let completionJwt = session.buckets.length === 0 ? session.jwt : undefined;
  for (const bucket of session.buckets) {
    if (!Array.isArray(bucket) || !bucket.length) throw new Error('Invalid assets upload bucket');
    const body = new FormData();
    for (const hash of bucket) {
      const file = plan.files.get(hash);
      if (!file) throw new Error('Cloudflare requested an unknown asset hash');
      body.append(hash, new Blob([file.bytes.toString('base64')], { type: file.type }), hash);
    }
    const result = await api(`${accountPath}/assets/upload?base64=true`, { method: 'POST', token: session.jwt, body });
    if (result?.jwt) completionJwt = result.jwt;
  }
  if (!completionJwt) throw new Error('No assets completion JWT; refusing script upload');
  const metadata = metadataFor(plan, completionJwt, migrationTag);
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json');
  for (const module of plan.modules) {
    body.append(module.name, new Blob([module.bytes], { type: 'application/javascript+module' }), module.name);
  }
  await api(scriptPath, { method: 'PUT', body });
  log(`Uploaded and deployed ${SCRIPT}; existing secret_text bindings retained. Configuring application secrets…`);
  for (const name of ['SESSION_SECRET', 'IP_HASH_SALT', ...(env.OPS_TOKEN ? ['OPS_TOKEN'] : [])]) {
    await api(`${scriptPath}/secrets`, { method: 'PUT', body: { name, text: env[name], type: 'secret_text' } });
  }
  log(`Deployment complete: ${SCRIPT}; ${Object.keys(plan.manifest).length} assets. Routes and Access unchanged.`);
  return { script: SCRIPT, assets: Object.keys(plan.manifest).length, migrated: migrationTag !== 'v2' };
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--dry-run') || args.length > 1) throw new Error('Usage: node cloudflare/deploy.mjs [--dry-run]');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required');
  return deploy({ dryRun: args.includes('--dry-run') });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Deployment failed: ${error.message}`); process.exitCode = 1; });
}
