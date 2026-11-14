// QR Code Model 2, byte mode, error correction M, versions 1–10.
// Self-contained ISO/IEC 18004 construction; no browser/network dependencies.
const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
function rawModules(v) {
  let result = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; result -= (25 * n - 10) * n - 55; if (v >= 7) result -= 36; }
  return result;
}
function multiply(a, b) {
  let out = 0;
  for (let i = 7; i >= 0; i--) { out = (out << 1) ^ ((out >>> 7) * 0x11d); out ^= ((b >>> i) & 1) * a; }
  return out;
}
function interleave(data, version) {
  const count = BLOCKS[version], degree = ECC[version], total = Math.floor(rawModules(version) / 8);
  const shortSize = Math.floor(total / count), shortCount = count - total % count;
  const divisor = Array(degree).fill(0); divisor[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) { divisor[j] = multiply(divisor[j], root); if (j + 1 < degree) divisor[j] ^= divisor[j + 1]; }
    root = multiply(root, 2);
  }
  const blocks = []; let offset = 0;
  for (let i = 0; i < count; i++) {
    const size = shortSize - degree + (i < shortCount ? 0 : 1);
    const part = data.slice(offset, offset + size); offset += size;
    const remainder = Array(degree).fill(0);
    for (const value of part) {
      const factor = value ^ remainder.shift(); remainder.push(0);
      for (let j = 0; j < degree; j++) remainder[j] ^= multiply(divisor[j], factor);
    }
    blocks.push({ data: part, ecc: remainder });
  }
  const out = [];
  for (let i = 0; i <= shortSize - degree; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < degree; i++) for (const b of blocks) out.push(b.ecc[i]);
  return out;
}
const MASKS = [
  (x,y)=>(x+y)%2===0, (x,y)=>y%2===0, (x,y)=>x%3===0, (x,y)=>(x+y)%3===0,
  (x,y)=>(Math.floor(y/2)+Math.floor(x/3))%2===0, (x,y)=>x*y%2+x*y%3===0,
  (x,y)=>(x*y%2+x*y%3)%2===0, (x,y)=>((x+y)%2+x*y%3)%2===0,
];
function penalty(m) {
  const size = m.length; let score = 0, dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    dark += Number(m[y][x]);
    if (x && y && m[y][x] === m[y-1][x] && m[y][x] === m[y][x-1] && m[y][x] === m[y-1][x-1]) score += 3;
  }
  for (let axis = 0; axis < 2; axis++) for (let a = 0; a < size; a++) {
    let run = 0, previous = null, line = '';
    for (let b = 0; b < size; b++) {
      const value = axis ? m[b][a] : m[a][b]; line += value ? '1' : '0';
      if (value === previous) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
      else { previous = value; run = 1; }
    }
    // The four light modules may lie in the required quiet zone.
    line = '0000' + line + '0000';
    for (let i = 0; i <= line.length - 11; i++) if (['00001011101','10111010000'].includes(line.slice(i, i+11))) score += 40;
  }
  return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
}
/** Return a row-major boolean matrix (without the four-module quiet zone).
 * UTF-8 text uses ECI 26 when needed; ASCII URLs use plain byte mode.
 * Throws RangeError beyond version 10/M's capacity (213 ASCII bytes).
 */
export function qrMatrix(text) {
  if (typeof text !== 'string') throw new TypeError('QR text must be a string');
  // Bound allocation before UTF-8 encoding; no accepted input can exceed this.
  if (text.length > 213) throw new RangeError('QR text exceeds version 10/M capacity');
  const bytes = new TextEncoder().encode(text), eci = bytes.some(b => b >= 128);
  let version = 1, capacity;
  for (; version <= 10; version++) {
    capacity = Math.floor(rawModules(version) / 8) - ECC[version] * BLOCKS[version];
    if ((eci ? 12 : 0) + 4 + (version < 10 ? 8 : 16) + bytes.length * 8 <= capacity * 8) break;
  }
  if (version > 10) throw new RangeError('QR text exceeds version 10/M capacity');
  const bits = [];
  const append = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  if (eci) { append(7, 4); append(26, 8); }
  append(4, 4); append(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) append(b, 8);
  append(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i,i+8).reduce((a,b)=>a*2+b, 0));
  for (let pad = 0; data.length < capacity; pad++) data.push(pad % 2 ? 0x11 : 0xec);
  const codewords = interleave(data, version), size = version * 4 + 17;
  const base = Array.from({length:size},()=>Array(size).fill(false));
  const reserved = base.map(row=>row.slice());
  const set = (x,y,value) => { base[y][x] = Boolean(value); reserved[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6,i,i%2===0); set(i,6,i%2===0); }
  for (const [cx,cy] of [[3,3],[size-4,3],[3,size-4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = cx+dx, y = cy+dy, distance = Math.max(Math.abs(dx),Math.abs(dy));
    if (x>=0 && y>=0 && x<size && y<size) set(x,y,distance!==2 && distance!==4);
  }
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2, step = Math.floor((version*4+count*2+1)/(count*2-2))*2;
    const positions = [6]; for (let p = size-7; positions.length < count; p -= step) positions.splice(1,0,p);
    for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) {
      if ((i===0 && j===0) || (i===0 && j===count-1) || (i===count-1 && j===0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(positions[i]+dx,positions[j]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
    }
  }
  const format = (matrix,mask) => {
    // M has format level bits 00. BCH(15,5), then fixed XOR mask.
    let rem = mask; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const value = ((mask << 10) | rem) ^ 0x5412;
    const put = (x,y,i) => { matrix[y][x] = Boolean((value >>> i)&1); reserved[y][x] = true; };
    for (let i = 0; i <= 5; i++) put(8,i,i);
    put(8,7,6); put(8,8,7); put(7,8,8);
    for (let i = 9; i < 15; i++) put(14-i,8,i);
    for (let i = 0; i < 8; i++) put(size-1-i,8,i);
    for (let i = 8; i < 15; i++) put(8,size-15+i,i);
    matrix[size-8][8] = true; reserved[size-8][8] = true;
  };
  format(base,0);
  if (version >= 7) {
    let rem = version; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const value = (version << 12) | rem;
    for (let i = 0; i < 18; i++) { const a = size-11+i%3, b = Math.floor(i/3); set(a,b,(value>>>i)&1); set(b,a,(value>>>i)&1); }
  }
  let index = 0;
  for (let right = size-1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      const y = ((right+1)&2) === 0 ? size-1-vertical : vertical;
      for (let j = 0; j < 2; j++) {
        const x = right-j;
        if (!reserved[y][x]) { base[y][x] = index < codewords.length*8 && Boolean((codewords[index>>>3] >>> (7-(index&7)))&1); index++; }
      }
    }
  }
  let best, minimum = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const matrix = base.map((row,y)=>row.map((value,x)=>reserved[y][x] ? value : value !== MASKS[mask](x,y)));
    format(matrix,mask);
    const score = penalty(matrix); if (score < minimum) { minimum = score; best = matrix; }
  }
  return best;
}
/** A safe standalone SVG string, including the mandatory white quiet zone.
 * Text is encoded only as modules, never interpolated into markup.
 */
export function qrSvg(text) {
  const matrix = qrMatrix(text), size = matrix.length + 8;
  const paths = [];
  for (let y = 0; y < matrix.length; y++) for (let x = 0; x < matrix.length; x++) if (matrix[y][x]) paths.push(`M${x+4},${y+4}h1v1h-1z`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${paths.join('')}" fill="#000"/></svg>`;
}
