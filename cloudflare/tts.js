import { sha256 } from './auth.js';
export const TTS_MODEL = '@cf/deepgram/aura-1';
export const TTS_SPEAKER = 'asteria';
export const MAX_CLIP_BYTES = 512 * 1024;
export const MAX_CACHE_BYTES = 400 * 1024 * 1024;
export const isMP3 = bytes => (bytes.length >= 3 && bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) || (bytes.length >= 2 && bytes[0] === 255 && (bytes[1] & 224) === 224);
const audioResponse = bytes => new Response(bytes, {headers:{'Content-Type':'audio/mpeg', 'Cache-Control':'public, max-age=31536000, immutable', 'X-Content-Type-Options':'nosniff'}});
const pending = new WeakMap();
const failure = (error, status) => Response.json({error}, {status, headers:{'Cache-Control':'no-store'}});

// Aura returns MPEG streams; accept Response and legacy JSON wrappers defensively.
export async function audioBytes(output) {
  if (output instanceof Response) {
    if (!output.ok) throw Error('AI response failed');
    return output.headers.get('content-type')?.includes('json')
      ? audioBytes(await output.json()) : new Uint8Array(await output.arrayBuffer());
  }
  if (output?.audio !== undefined) return audioBytes(output.audio);
  if (typeof output === 'string') {
    const raw = atob(output.replace(/^data:audio\/[^;]+;base64,/, ''));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  if (output instanceof ReadableStream) return new Uint8Array(await new Response(output).arrayBuffer());
  if (output instanceof ArrayBuffer) return new Uint8Array(output);
  if (ArrayBuffer.isView(output)) return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
  throw Error('Unsupported AI audio');
}

export async function tts(request, env, reserve, ctx, record = async()=>{}) {
  const url = new URL(request.url), text = (url.searchParams.get('text') || '').trim();
  const lang = url.searchParams.get('lang') || 'en';
  if (!text || text.length > 300 || lang !== 'en') return failure('Invalid speech text or language', 400);
  const speaker = env.TTS_SPEAKER || TTS_SPEAKER;
  const hash = await sha256(`${TTS_MODEL}|${speaker}|mp3|${lang}|${text}`);
  const key = new Request('https://tts-cache.internal/v2/' + hash);
  const durable = env.TTS_CACHE?.get(env.TTS_CACHE.idFromName('tts-cache'));
  const durableKey = 'https://internal/' + hash;
  const cache = globalThis.caches?.default;
  try {
    const hit = await cache?.match(key);
    if (hit) { await record('cache_hits'); return hit; }
  } catch { /* Cache eviction/outage must not disable speech. */ }
  try {
    const hit = await durable?.fetch(new Request(durableKey));
    if (hit?.ok) {
      const bytes = new Uint8Array(await hit.arrayBuffer());
      if (isMP3(bytes) && bytes.length <= MAX_CLIP_BYTES) {
        const response = audioResponse(bytes);
        try { await cache?.put(key, response.clone()); } catch { /* Best effort. */ }
        await record('cache_hits');
        return response;
      }
    }
  } catch { /* Durable cache outages must not disable synthesis. */ }
  if (!env.AI?.run) return failure('voice_unavailable', 503);
  let inflight = pending.get(env);
  if (!inflight) pending.set(env, inflight = new Map());
  if (!inflight.has(key.url)) {
    const task = (async () => {
      let timer;
      try {
        const limited = await reserve(text.length);
        if (!limited.ok) { if(limited.status===429) await record('quota_429'); return limited; }
        // Leave enough time for the browser's 4-second fallback deadline.
        const bytes = await Promise.race([
          Promise.resolve(env.AI.run(TTS_MODEL, {text, speaker, encoding:'mp3'})).then(audioBytes),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('AI timeout')), 3500); }),
        ]);
        if (!isMP3(bytes) || bytes.byteLength > MAX_CLIP_BYTES) throw Error('Invalid or oversized MP3');
        await record('synthesized_characters',text.length);
        const response = audioResponse(bytes);
        try { await durable?.fetch(new Request(durableKey, {method:'PUT', body:bytes})); } catch { /* Best effort. */ }
        // Await writes so the next request cannot miss between synthesis and put.
        try { await cache?.put(key, response.clone()); } catch { /* Best effort. */ }
        return response;
      } catch { return failure('voice_unavailable', 503); }
      finally { clearTimeout(timer); }
    })();
    inflight.set(key.url, task);
    const cleanup = task.finally(() => inflight.delete(key.url));
    ctx?.waitUntil(cleanup.catch(() => {}));
  }
  return (await inflight.get(key.url)).clone();
}

// One shared SQLite DO, independent of edge-cache eviction/datacenter placement.
export class TtsCache {
  constructor(ctx) {
    this.ctx = ctx; this.sql = ctx.storage.sql; this.maxBytes = MAX_CACHE_BYTES;
    this.sql.exec('CREATE TABLE IF NOT EXISTS tts_cache(key TEXT PRIMARY KEY,audio BLOB NOT NULL,bytes INT NOT NULL,created INT NOT NULL,last_used INT NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS tts_cache_lru ON tts_cache(last_used,created,key)');
  }
  fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const key = new URL(request.url).pathname.slice(1);
      if (!/^[a-f0-9]{64}$/.test(key)) return new Response(null, {status:400});
      if (request.method === 'GET') {
        const row = [...this.sql.exec('SELECT audio FROM tts_cache WHERE key=?', key)][0];
        if (!row) return new Response(null, {status:404});
        this.sql.exec('UPDATE tts_cache SET last_used=? WHERE key=?', Date.now(), key);
        return audioResponse(row.audio);
      }
      if (request.method !== 'PUT') return new Response(null, {status:405});
      if (Number(request.headers.get('content-length')) > MAX_CLIP_BYTES) return new Response(null, {status:413});
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > MAX_CLIP_BYTES) return new Response(null, {status:413});
      if (!isMP3(bytes)) return new Response(null, {status:400});
      this.ctx.storage.transactionSync(() => {
        const now = Date.now();
        this.sql.exec('INSERT INTO tts_cache VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET audio=excluded.audio,bytes=excluded.bytes,last_used=excluded.last_used', key, bytes, bytes.length, now, now);
        let total = [...this.sql.exec('SELECT COALESCE(SUM(bytes),0) AS total FROM tts_cache')][0].total;
        while (total > this.maxBytes) {
          const oldest = [...this.sql.exec('SELECT key,bytes FROM tts_cache ORDER BY last_used,created,key LIMIT 1')][0];
          this.sql.exec('DELETE FROM tts_cache WHERE key=?', oldest.key); total -= oldest.bytes;
        }
      });
      return new Response(null, {status:204});
    });
  }
}
