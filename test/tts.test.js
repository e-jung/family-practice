import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { AudioCache, synthesize, wav } from "../lib/tts.js";
const temp = () => mkdtemp(path.resolve("test/.tmp-tts-"));
test("Wyoming parses fragmented headers, byte lengths, metadata and PCM into a WAV", async (t) => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  let request;
  const server = net.createServer((s) => {
    let b = Buffer.alloc(0);
    s.on("data", (chunk) => {
      b = Buffer.concat([b, chunk]);
      const n = b.indexOf(10);
      if (n < 0) return;
      const h = JSON.parse(b.subarray(0, n));
      if (b.length < n + 1 + h.data_length) return;
      request = {
        h,
        data: JSON.parse(b.subarray(n + 1, n + 1 + h.data_length)),
      };
      const event = (type, data, payload = Buffer.alloc(0), inline = {}) => {
        const d = Buffer.from(JSON.stringify(data));
        return Buffer.concat([
          Buffer.from(
            JSON.stringify({
              type,
              data_length: d.length,
              payload_length: payload.length,
              data: inline,
            }) + "\n",
          ),
          d,
          payload,
        ]);
      };
      const out = Buffer.concat([
        event("audio-start", { rate: 22050, width: 2 }, Buffer.alloc(0), {
          channels: 1,
        }),
        event("audio-chunk", { note: "chunk" }, pcm.subarray(0, 4)),
        event("audio-chunk", {}, pcm.subarray(4)),
        event("audio-stop", {}),
      ]);
      // Write across header and UTF-8 data boundaries to exercise framing, not packet assumptions.
      s.write(out.subarray(0, 17));
      setTimeout(() => {
        s.write(out.subarray(17, 61));
        setTimeout(() => s.end(out.subarray(61)), 5);
      }, 5);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const out = await synthesize({
    host: "127.0.0.1",
    port: server.address().port,
    voice: "en_US-lessac-high",
    text: "café — light",
  });
  assert.equal(request.h.type, "synthesize");
  assert.equal(request.h.version, "1.5.4");
  assert.equal(
    request.h.data_length,
    Buffer.byteLength(JSON.stringify(request.data)),
  );
  assert.equal(request.data.voice.name, "en_US-lessac-high");
  assert.equal(request.data.text, "café — light");
  assert.equal(out.toString("ascii", 0, 4), "RIFF");
  assert.equal(out.readUInt32LE(24), 22050);
  assert.equal(out.readUInt16LE(22), 1);
  assert.equal(out.readUInt16LE(34), 16);
  assert.equal(out.readUInt32LE(40), pcm.length);
  assert.deepEqual(out.subarray(44), pcm);
});
test("Wyoming rejects truncated responses rather than caching partial audio", async (t) => {
  const server = net.createServer((s) =>
    s.once("data", () =>
      s.end('{"type":"audio-chunk","payload_length":8}\nxx'),
    ),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  await assert.rejects(
    synthesize({
      host: "127.0.0.1",
      port: server.address().port,
      voice: "test",
      text: "hi",
    }),
    /before audio-stop/,
  );
});
test("cache dedupes concurrent requests, serializes distinct clips and separates voices", async (t) => {
  const dir = await temp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  let calls = 0,
    active = 0,
    max = 0;
  const cache = new AudioCache({
    dir,
    synth: async () => {
      calls++;
      active++;
      max = Math.max(active, max);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return wav(Buffer.from([1, 2]), 16000, 2, 1);
    },
  });
  const a = await Promise.all([
    cache.get("hello", "a"),
    cache.get("hello", "a"),
    cache.get("bye", "a"),
  ]);
  assert.deepEqual(a[0], a[1]);
  assert.equal(calls, 2);
  assert.equal(max, 1);
  await cache.get("hello", "a");
  assert.equal(calls, 2);
  await cache.get("hello", "b");
  assert.equal(calls, 3);
  assert.equal((await cache.status()).cached, 3);
});
test("unreachable synthesis opens one-minute circuit breaker and still serves cached audio", async (t) => {
  const dir = await temp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const cache = new AudioCache({
    dir,
    synth: async ({ text }) => {
      calls++;
      if (text === "bad") throw Error("unreachable");
      return wav(Buffer.from([0, 0]), 22050, 2, 1);
    },
  });
  await cache.get("good", "a");
  await assert.rejects(cache.get("bad", "a"));
  await assert.rejects(cache.get("other", "a"), /unavailable/);
  assert.equal(calls, 2);
  assert.ok((await cache.get("good", "a")).length);
  assert.equal((await cache.status()).reachable, false);
  assert.ok((await cache.status()).retryAfter > 0);
});

test("audio admission and disk cache are bounded", async (t) => {
  const dir = await temp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  let release;
  const cache = new AudioCache({
    dir,
    maxPending: 1,
    maxCacheBytes: 50,
    synth: async () => {
      await new Promise((resolve) => {
        release = resolve;
      });
      return wav(Buffer.from([0, 0]), 22050, 2, 1);
    },
  });
  const first = cache.get("one", "a");
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  await assert.rejects(cache.get("two", "a"), /queue is full/);
  release();
  await first;
  const second = cache.get("two", "a");
  const previous = release;
  while (release === previous)
    await new Promise((resolve) => setTimeout(resolve, 1));
  release();
  await second;
  assert.equal((await cache.status()).cached, 1);
});

// An empty host must not let Node silently connect to localhost.
test("unconfigured Piper fails locally and reports unavailable without probing", async (t) => {
  const dir = await temp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cache = new AudioCache({ dir, host: "" });
  await cache.probe();
  assert.equal((await cache.status()).reachable, false);
  await assert.rejects(cache.get("hello", "test"), /PIPER_HOST is required/);
  assert.equal((await cache.status()).cached, 0);
  await assert.rejects(synthesize({ host: " ", port: 10200, text: "hello" }), /PIPER_HOST is required/);
});
