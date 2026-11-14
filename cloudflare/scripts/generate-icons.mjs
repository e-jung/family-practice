// Reproducible PNG icons using only Node built-ins. Run: node cloudflare/scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
const destination = new URL('../public/icons/', import.meta.url);
await mkdir(destination, { recursive: true });
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(data));
  return Buffer.concat([size, data, crc]);
}
for (const size of [180, 192, 512]) {
  const pixels = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Sun and open book, kept within the maskable central safe circle.
    const u = x / size, v = y / size;
    const sun = (u - .5) ** 2 + (v - .34) ** 2 < .075 ** 2;
    const book = u > .26 && u < .74 && v > .47 + Math.abs(u - .5) * .25 && v < .68 + Math.abs(u - .5) * .25;
    const spine = Math.abs(u - .5) < .009 && v > .47 && v < .69;
    const color = sun ? [232, 182, 77] : book && !spine ? [251, 247, 238] : [49, 93, 81];
    const offset = y * (size * 3 + 1) + 1 + x * 3;
    for (let c = 0; c < 3; c++) pixels[offset + c] = color[c];
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  await writeFile(new URL(`icon-${size}.png`, destination), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
}
