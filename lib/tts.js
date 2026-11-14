import net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
export const VOICES = [
  "en_US-lessac-high",
  "en_US-ryan-high",
  "en_US-amy-medium",
  "en_US-kristin-medium",
  "en_US-libritts_r-medium",
  "en_US-hfc_female-medium",
];
export function wav(pcm, rate, width, channels) {
  if (
    !Number.isInteger(rate) ||
    rate < 1000 ||
    rate > 192000 ||
    ![1, 2, 3, 4].includes(width) ||
    ![1, 2].includes(channels)
  )
    throw Error("Invalid audio format");
  const b = Buffer.alloc(44);
  b.write("RIFF");
  b.writeUInt32LE(36 + pcm.length, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * width * channels, 28);
  b.writeUInt16LE(width * channels, 32);
  b.writeUInt16LE(width * 8, 34);
  b.write("data", 36);
  b.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([b, pcm]);
}
export function synthesize({
  host,
  port,
  voice,
  text,
  connectTimeout = 2000,
  responseTimeout = 120000,
}) {
  if (!host?.trim())
    return Promise.reject(Error("PIPER_HOST is required for Piper speech"));
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0),
      header = null,
      format = null,
      pcm = [],
      size = 0,
      done = false;
    const s = net.createConnection({ host, port });
    const connectTimer = setTimeout(
      () => finish(Error("Piper connection timed out")),
      connectTimeout,
    );
    let timer;
    function finish(err, result) {
      if (done) return;
      done = true;
      clearTimeout(connectTimer);
      clearTimeout(timer);
      s.destroy();
      err ? reject(err) : resolve(result);
    }
    s.on("connect", () => {
      clearTimeout(connectTimer);
      timer = setTimeout(
        () => finish(Error("Piper response timed out")),
        responseTimeout,
      );
      const d = Buffer.from(JSON.stringify({ text, voice: { name: voice } }));
      s.write(
        Buffer.concat([
          Buffer.from(
            JSON.stringify({
              type: "synthesize",
              data_length: d.length,
              version: "1.5.4",
            }) + "\n",
          ),
          d,
        ]),
      );
    });
    s.on("error", finish);
    s.on("end", () => {
      if (!done) finish(Error("Piper closed before audio-stop"));
    });
    s.on("data", (chunk) => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 32 * 1024 * 1024) throw Error("Audio too large");
        while (!done) {
          if (!header) {
            const n = buffer.indexOf(10);
            if (n < 0) {
              if (buffer.length > 65536) throw Error("Header too large");
              break;
            }
            header = JSON.parse(buffer.subarray(0, n).toString());
            buffer = buffer.subarray(n + 1);
            for (const k of ["data_length", "payload_length"])
              if (
                header[k] !== undefined &&
                (!Number.isSafeInteger(header[k]) ||
                  header[k] < 0 ||
                  header[k] > 32 * 1024 * 1024)
              )
                throw Error("Invalid framing");
          }
          const dl = header.data_length || 0,
            pl = header.payload_length || 0;
          if (buffer.length < dl + pl) break;
          const d = {
              ...(dl ? JSON.parse(buffer.subarray(0, dl).toString()) : {}),
              ...header.data,
            },
            payload = buffer.subarray(dl, dl + pl);
          buffer = buffer.subarray(dl + pl);
          if (header.type === "error")
            throw Error(d.text || "Piper synthesis failed");
          if (header.type === "audio-start") format = d;
          if (header.type === "audio-chunk") {
            size += payload.length;
            if (size > 32 * 1024 * 1024) throw Error("Audio too large");
            pcm.push(payload);
          }
          if (header.type === "audio-stop") {
            if (!format || !size) throw Error("Piper returned no audio");
            finish(
              null,
              wav(
                Buffer.concat(pcm),
                format.rate,
                format.width,
                format.channels,
              ),
            );
          }
          header = null;
        }
      } catch (e) {
        finish(e);
      }
    });
  });
}
export class AudioCache {
  constructor({
    dir,
    host = process.env.PIPER_HOST || "",
    port = Number(process.env.PIPER_PORT || 10200),
    synth = synthesize,
    maxPending = 64,
    maxCacheBytes = 512 * 1024 * 1024,
  }) {
    this.dir = dir;
    this.host = host;
    this.port = port;
    this.synth = synth;
    this.maxPending = maxPending;
    this.maxCacheBytes = maxCacheBytes;
    this.prewarmTail = Promise.resolve();
    this.pending = new Map();
    this.tail = Promise.resolve();
    this.unavailableUntil = 0;
    this.reachable = null;
  }
  key(voice, text) {
    return createHash("sha256")
      .update(JSON.stringify([voice, text]))
      .digest("hex");
  }
  async get(text, voice) {
    const key = this.key(voice, text),
      file = path.join(this.dir, key + ".wav");
    try {
      return await readFile(file);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= this.maxPending)
      throw Error("Audio queue is full; use browser speech");
    if (Date.now() < this.unavailableUntil)
      throw Error("Piper temporarily unavailable; browser voice is available");
    const work = this.tail
      .catch(() => {})
      .then(async () => {
        if (Date.now() < this.unavailableUntil)
          throw Error("Piper temporarily unavailable");
        try {
          const b = await this.synth({
            host: this.host,
            port: this.port,
            voice,
            text,
          });
          await mkdir(this.dir, { recursive: true });
          const tmp = file + "." + randomUUID() + ".tmp";
          await writeFile(tmp, b);
          await rename(tmp, file);
          await this.trimCache();
          this.reachable = true;
          return b;
        } catch (e) {
          this.reachable = false;
          this.unavailableUntil = Date.now() + 60000;
          throw e;
        }
      });
    this.pending.set(key, work);
    this.tail = work;
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }
  prewarm(clips, voice) {
    // Feed one background clip at a time so foreground practice can get in line.
    const unique = [...new Set(clips.filter(Boolean))];
    this.prewarmTail = this.prewarmTail
      .catch(() => {})
      .then(async () => {
        for (const text of unique) await this.get(text, voice).catch(() => {});
      });
  }
  async trimCache() {
    const files = await Promise.all(
      (await readdir(this.dir))
        .filter((name) => /^[a-f0-9]{64}\.wav$/.test(name))
        .map(async (name) => ({
          name,
          ...(await stat(path.join(this.dir, name))),
        })),
    );
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= this.maxCacheBytes) break;
      await unlink(path.join(this.dir, file.name));
      total -= file.size;
    }
  }
  async status() {
    let cached = 0;
    try {
      cached = (await readdir(this.dir)).filter((x) =>
        x.endsWith(".wav"),
      ).length;
    } catch {}
    return {
      reachable: this.reachable,
      cached,
      queued: this.pending.size,
      retryAfter: Math.max(
        0,
        Math.ceil((this.unavailableUntil - Date.now()) / 1000),
      ),
    };
  }
  async probe() {
    if (!this.host?.trim()) {
      this.reachable = false;
      return;
    }
    if (Date.now() < this.unavailableUntil) return;
    await new Promise((resolve) => {
      const s = net.createConnection({ host: this.host, port: this.port });
      const finish = (ok) => {
        s.destroy();
        this.reachable = ok;
        if (!ok) this.unavailableUntil = Date.now() + 60000;
        resolve();
      };
      s.setTimeout(2000, () => finish(false));
      s.once("connect", () => finish(true));
      s.once("error", () => finish(false));
    });
  }
}
