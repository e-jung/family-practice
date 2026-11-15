import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { qrMatrix, qrSvg } from '../public/qr.js';

// Independent qrcode 1.5.4 byte-mode / M reference matrices, pinned masks.
// Every matrix was also rasterized with a four-module quiet zone and decoded
// with jsQR 1.4.0 during development. Neither package is a project dependency.
// These boundary vectors cover every version, mixed-size RS blocks, alignment,
// BCH version information (7+), and the 16-bit byte count in version 10.
const vectors = [
  {
    "n": 1,
    "v": 1,
    "mask": 4,
    "hash": "1968f60e7135599755aeeb18939e54436e46a69149498f605bb1e4851f6b9fd0"
  },
  {
    "n": 14,
    "v": 1,
    "mask": 2,
    "hash": "57987d1ffbed8e80926698b4c5e9029d724738716cd2cfdc05b908d3af512e26"
  },
  {
    "n": 15,
    "v": 2,
    "mask": 0,
    "hash": "be1f4b93f39e9f2b2078c3ee1b75b380b920cf717fadc9593dca07aa7f0a32e0"
  },
  {
    "n": 26,
    "v": 2,
    "mask": 0,
    "hash": "6b3c728f6da5c7377b04cb658bb6886dfd429af638146625b3ff14c24c6b80bf"
  },
  {
    "n": 27,
    "v": 3,
    "mask": 2,
    "hash": "26ca721a90031f183fce0a0d53822e2e653349363900c4892064ca88290bc964"
  },
  {
    "n": 42,
    "v": 3,
    "mask": 0,
    "hash": "29e68797907db7dd92b0e7358e2089adb22d5126e017b6897d44ee6579e8558e"
  },
  {
    "n": 43,
    "v": 4,
    "mask": 2,
    "hash": "1f4d2e04b148eb84316021d2c0135fc89d5177b03bb7e76a4190575baf7dc199"
  },
  {
    "n": 62,
    "v": 4,
    "mask": 0,
    "hash": "9040f52bb1e8a29864239cab4d100956b91f7072a4a936eac1c4512567671e4f"
  },
  {
    "n": 63,
    "v": 5,
    "mask": 2,
    "hash": "fcc8278569d63b26ffb606f813853af872249d8da212fdd5a580b766bfea7146"
  },
  {
    "n": 84,
    "v": 5,
    "mask": 0,
    "hash": "11f4048c14db893ba9ec71a952fe3ae264b41d07071e231158177e8437c3882b"
  },
  {
    "n": 85,
    "v": 6,
    "mask": 0,
    "hash": "8b03df5e80a2420b68909e8417c061142f28cac4e8126a14980b3910754b7488"
  },
  {
    "n": 106,
    "v": 6,
    "mask": 3,
    "hash": "536f804ac066bd508901c3133f627c8fe275f79e23bcdf61ae9e1f3fa94dfb8c"
  },
  {
    "n": 107,
    "v": 7,
    "mask": 2,
    "hash": "f461d081f0015b88a3390a99d1ccdb1048f1451cdd5d5f11ef0b9a67f63883bb"
  },
  {
    "n": 122,
    "v": 7,
    "mask": 0,
    "hash": "91c925bdfb77e72b0588d633a6da626a8e78d53a86b2fc001044e012bc75568f"
  },
  {
    "n": 123,
    "v": 8,
    "mask": 2,
    "hash": "5926f6dcd6e9cb95c6da80988660cb86108d4c0dae2f62dc3e81b7c81f476e98"
  },
  {
    "n": 152,
    "v": 8,
    "mask": 2,
    "hash": "05776ce767bdb1a4a404252de39d3032d7d7ce80b71848a6277de518cd31cff3"
  },
  {
    "n": 153,
    "v": 9,
    "mask": 0,
    "hash": "591bbea64aed3057fdf779a510b3e83bc4cf9a26210f8a24c185eee6827d3934"
  },
  {
    "n": 180,
    "v": 9,
    "mask": 0,
    "hash": "21e02ceea8d235cf29ba53f809c61e9bca5b25910dfa51ccb01292bb14777f09"
  },
  {
    "n": 181,
    "v": 10,
    "mask": 2,
    "hash": "6f87f0f4e0a3a51093cf8a62ff8b28bb46b0a7c7756a60d553f619c8139228b0"
  },
  {
    "n": 213,
    "v": 10,
    "mask": 0,
    "hash": "f8a692e420006d88c10e55f6fb2f048c68ad07db0d7c3f134adf4ff3fc04aae2"
  }
];
for (const {n, v, mask, hash} of vectors) {
  test(`QR byte/M independent vector: ${n} bytes, version ${v}, mask ${mask}`, () => {
    const matrix = qrMatrix('x'.repeat(n));
    assert.equal(matrix.length, 17 + v * 4);
    assert.ok(matrix.every(row => row.length === matrix.length && row.every(x => typeof x === 'boolean')));
    const actual = createHash('sha256').update(matrix.map(row => row.map(Number).join('')).join('\n')).digest('hex');
    assert.equal(actual, hash);
  });
}

test('QR rejects oversize or nonstring input rather than truncating', () => {
  for (const input of [undefined, null, 42, {}, new String('hello')]) assert.throws(() => qrMatrix(input), TypeError);
  for (const input of ['x'.repeat(214), 'é'.repeat(107), '🍃'.repeat(54), 'x'.repeat(100000)]) {
    assert.throws(() => qrMatrix(input), RangeError);
    assert.throws(() => qrSvg(input), RangeError);
  }
  assert.equal(qrMatrix('é'.repeat(106)).length, 57);
  assert.equal(qrMatrix('🍃'.repeat(53)).length, 57);
});

test('empty, URL, Unicode and markup payloads produce deterministic independent matrices', () => {
  // All four were independently decoded with jsQR during development.
  for (const text of ['', 'https://spellami.jesklabs.com/s/AbCdEf0123456789', 'é🍃 Bible verses — 漢字', '<script>alert("&")</script>']) {
    assert.deepEqual(qrMatrix(text), qrMatrix(text));
    const first = qrMatrix(text); first[0][0] = !first[0][0];
    assert.notDeepEqual(first, qrMatrix(text), 'callers cannot mutate a cached result');
  }
});

test('SVG has opaque quiet zone, crisp modules, accessible label and no raw user markup', () => {
  const payload = '<script>alert("&")</script>', matrix = qrMatrix(payload), svg = qrSvg(payload);
  const size = matrix.length + 8;
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes(`viewBox="0 0 ${size} ${size}"`));
  assert.ok(svg.includes(`rect width="${size}" height="${size}" fill="#fff"`));
  assert.ok(svg.includes('role="img" aria-label="QR code"'));
  assert.ok(svg.includes('shape-rendering="crispEdges"'));
  assert.ok(!svg.includes(payload) && !svg.includes('<script') && !svg.includes('alert'));
  const commands = [...svg.matchAll(/M(\d+),(\d+)h1v1h-1z/g)];
  assert.equal(commands.length, matrix.flat().filter(Boolean).length);
  for (const [,x,y] of commands) {
    assert.ok(Number(x) >= 4 && Number(x) < size - 4);
    assert.ok(Number(y) >= 4 && Number(y) < size - 4);
    assert.equal(matrix[Number(y)-4][Number(x)-4], true);
  }
});
