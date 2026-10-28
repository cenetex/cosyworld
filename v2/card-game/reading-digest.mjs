// A deterministic content digest shared by the browser and bounded QuickJS.
export function utf8Length(text) {
  let size = 0;
  for (const character of text) {
    const point = character.codePointAt(0);
    size += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return size;
}

const constants = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const rotate = (n, amount) => (n >>> amount) | (n << (32 - amount));

export function readingDigest(text) {
  const size = utf8Length(text);
  const body = new Uint8Array(Math.ceil((size + 9) / 64) * 64);
  let at = 0;
  for (const character of text) {
    let point = character.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
    if (point < 0x80) body[at++] = point;
    else if (point < 0x800) {
      body[at++] = 0xc0 | (point >>> 6);
      body[at++] = 0x80 | (point & 63);
    } else if (point < 0x10000) {
      body[at++] = 0xe0 | (point >>> 12);
      body[at++] = 0x80 | ((point >>> 6) & 63);
      body[at++] = 0x80 | (point & 63);
    } else {
      body[at++] = 0xf0 | (point >>> 18);
      body[at++] = 0x80 | ((point >>> 12) & 63);
      body[at++] = 0x80 | ((point >>> 6) & 63);
      body[at++] = 0x80 | (point & 63);
    }
  }
  body[size] = 0x80;
  const bits = size * 8;
  const view = new DataView(body.buffer);
  view.setUint32(body.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(body.length - 4, bits >>> 0);
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);
  for (let block = 0; block < body.length; block += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15],
        b = words[i - 2];
      words[i] =
        words[i - 16] +
        words[i - 7] +
        (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
        (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const first =
        (h +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          constants[i] +
          words[i]) >>>
        0;
      const second =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) +
          ((a & b) ^ (a & c) ^ (b & c))) >>>
        0;
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    for (const [i, value] of [a, b, c, d, e, f, g, h].entries())
      hash[i] = (hash[i] + value) >>> 0;
  }
  return hash.map((part) => part.toString(16).padStart(8, "0")).join("");
}
