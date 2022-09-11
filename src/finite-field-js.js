import { randomBytes } from "./builtin-crypto.js";
import { bigintFromBytes, bigintToBits } from "./util.js";

export {
  mod,
  field,
  scalar,
  modExp,
  modInverse,
  randomScalars,
  randomBaseField,
  randomBaseFieldx2,
};

let scalar = {
  p: 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n,
  minusZ: 0xd201000000010000n,
  bits: 255,
  bytes: 32,
  // montgomery stuff
  R: 1n << 256n, // montgomery radix 2^k
  Rm1: (1n << 256n) - 1n, // for &ing
  k: 256n,
  asBits: {
    minusZ: bigintToBits(0xd201000000010000n),
  },
};
scalar.mu = modInverse(-scalar.p, scalar.R);
scalar.mu0 = modInverse(-scalar.p, 1n << 32n);
scalar.Rmod = mod(scalar.R, scalar.p);
scalar.R2mod = mod(scalar.R * scalar.R, scalar.p);

let p =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;

let field = {
  p,
  t: 0xd0088f51cbff34d258dd3db21a5d66bb23ba5c279c2895fb39869507b587b120f55ffff58a9ffffdcff7fffffffd555n,
  bits: 381,
  bytes: 48,
  R: 1n << 384n, // montgomery radix 2^k
  Rm1: (1n << 384n) - 1n, // for &ing
  k: 384n,
  asBits: {
    pPlus1Div4: bigintToBits((p + 1n) / 4n, 381),
  },
};
field = {
  ...field,
  mu: modInverse(-field.p, field.R),
  mu0: modInverse(-field.p, 1n << 32n),
  Rmod: mod(field.R, field.p),
  R2mod: mod(field.R * field.R, field.p),
};

/**
 *
 * @param {bigint} x
 * @param {bigint} p
 * @returns {bigint}
 */
function mod(x, p) {
  x = x % p;
  return x < 0n ? x + p : x;
}

function modExp(a, n, { p }) {
  a = mod(a, p);
  // this assumes that p is prime, so that a^(p-1) % p = 1
  n = mod(n, p - 1n);
  let x = 1n;
  for (; n > 0n; n >>= 1n) {
    if (n & 1n) x = mod(x * a, p);
    a = mod(a * a, p);
  }
  return x;
}

// inverting with EGCD, 1/a in Z_p
/**
 *
 * @param {bigint} a
 * @param {bigint} p
 * @returns 1/a (mod p)
 */
function modInverse(a, p) {
  if (a === 0n) throw Error("cannot invert 0");
  a = mod(a, p);
  let b = p;
  let x = 0n;
  let y = 1n;
  let u = 1n;
  let v = 0n;
  while (a !== 0n) {
    let q = b / a;
    let r = mod(b, a);
    let m = x - u * q;
    let n = y - v * q;
    b = a;
    a = r;
    x = u;
    y = v;
    u = m;
    v = n;
  }
  if (b !== 1n) throw Error("inverting failed (no inverse)");
  return mod(x, p);
}

/**
 *
 * @param {number} n
 */
function randomScalars(n) {
  let N = n * 32 * 2;
  let bytes = randomBytes(N);
  /**
   * @type {Uint8Array[]}
   */
  let scalars = Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    while (true) {
      if (j + 32 > N) {
        bytes = randomBytes(N);
        j = 0;
      }
      let bytes_ = bytes.slice(j, j + 32);
      bytes_[31] &= 0x7f;
      j += 32;
      let x = bigintFromBytes(bytes_);
      if (x < scalar.p) {
        scalars[i] = bytes_;
        break;
      }
    }
  }
  return scalars;
}

/**
 *
 * @returns {bigint}
 */
function randomBaseField() {
  while (true) {
    let bytes = randomBytes(48);
    bytes[47] &= 0x1f;
    let x = bigintFromBytes(bytes);
    if (x < field.p) return x;
  }
}

/**
 *
 * @returns {bigint}
 */
function randomBaseFieldx2() {
  while (true) {
    let bytes = randomBytes(48);
    bytes[47] &= 0x3f;
    let x = bigintFromBytes(bytes);
    if (x < 2n * field.p) return x;
  }
}
