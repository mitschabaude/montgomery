import { randomBytes } from "./builtin-crypto.js";
import { bigintFromBytes, bigintToBits } from "./util.js";
import {
  multiply,
  isZero,
  storeField,
  storeFieldIn,
  equals,
  reduceInPlace,
  isGreater,
  subtractNoReduce,
  addNoReduce,
  makeOdd,
} from "./finite-field.wat.js";
import { readField, writeFieldInto } from "./wasm.js";

export {
  randomScalars,
  randomBaseField,
  randomBaseFieldx2,
  mod,
  field,
  scalar,
  modSqrt,
  modInverseMontgomery,
  modExp,
  modInverse,
  fromMontgomery,
  toMontgomery,
  fieldToUint64Array,
  fieldFromUint64Array,
  fieldToMontgomeryPointer,
  fieldFromMontgomeryPointer,
  rightShiftInPlace,
  leftShiftInPlace,
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
  toWasm: fieldToMontgomeryPointer,
  ofWasm: fieldFromMontgomeryPointer,
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

field.legs = {
  Rmod: storeField(fieldToUint64Array(field.Rmod)),
  R2mod: storeField(fieldToUint64Array(field.R2mod)),
  one: storeField(fieldToUint64Array(1n)),
  zero: storeField(fieldToUint64Array(0n)),
  p: storeField(fieldToUint64Array(p)),
  R2mod64: storeField(fieldToUint64Array(mod(field.R2mod * 64n, p))),
  R2mod128: storeField(fieldToUint64Array(mod(field.R2mod * 128n, p))),
};
field.legs.four = fieldToMontgomeryPointer(4n);
field.legs.eight = fieldToMontgomeryPointer(8n);

let pLegs = fieldToUint64Array(field.p);
let twoPLegs = fieldToUint64Array(2n * field.p);
let Rminus2PLegs = fieldToUint64Array(field.R - 2n * field.p);

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

/**
 *
 * @param {number[]} scratchSpace
 * @param {number} root
 * @param {number} x
 * @returns boolean indicating whether taking the root was successful
 */
function modSqrt([tmp], root, x) {
  // let root0 = modExp(fieldFromMontgomeryPointer([tmp], x), (field.p + 1n) / 4n, field);
  modExpMontgomery([tmp], root, x, field.asBits.pPlus1Div4);
  // if (root0 !== fieldFromMontgomeryPointer([tmp], root)) throw Error("not equal");
  multiply(tmp, root, root);
  reduceInPlace(tmp);
  reduceInPlace(x);
  if (!equals(tmp, x)) return false;
  return true;
}

/**
 * @param {number[]} scratchSpace
 * @param {number} x a^n
 * @param {number} a
 * @param {boolean[]} nBits
 */
function modExpMontgomery([a], x, a0, nBits) {
  let { Rmod } = field.legs;
  storeFieldIn(x, Rmod); // 1R
  storeFieldIn(a, a0);
  for (let bit of nBits) {
    if (bit) multiply(x, x, a);
    multiply(a, a, a);
  }
}

/**
 *
 * @param {number[]} scratchSpace
 * @param {number} ainv
 * @param {number} a0
 */
function modInverseMontgomery(scratchSpace, r, a) {
  if (isZero(a)) throw Error("cannot invert 0");
  reduceInPlace(a);
  let k = almostInverseMontgomery(scratchSpace, r, a);
  // TODO: negation -- special case which is simpler
  // don't have to reduce r here, because it's already < p
  // reduceInPlace(r);
  subtractNoReduce(r, field.legs.p, r);

  // mutliply by 2**(2n - k), where n = 381 = bit length of p
  // TODO: efficient multiplication by power-of-2?
  // we use k+1 here because that's the valuethe theory is about:
  // n <= k+1 <= 2n, so that 0 <= 2n-(k+1) <= n, so that
  // 1 <= 2**(2n-(k+1)) <= 2**n < 2p
  // (in practice, k seems to be normally distributed around ~1.5n and never reach either n or 2n)
  let l = 2 * 381 - (k + 1);
  let [r1] = scratchSpace;
  let r1_ = new BigUint64Array(12);
  r1_[l >> 5] = 1n << BigInt(l % 32);
  writeFieldInto(r1, r1_);
  multiply(r, r, r1);
  multiply(r, r, field.legs.R2mod128);
  // let a0 = fieldFromUint64Array(readField(a));
  // let r0 = fieldFromUint64Array(readField(r));
  // console.log(
  //   "1n",
  //   montgomeryReduction(montgomeryReduction(r0 * a0, field), field)
  // );
}

// this is modified from the algorithms in papers in that it
// * returns k-1 instead of k
// * returns r < p without unconditionally
// * allows to batch left- / right-shifts
function almostInverseMontgomery([u, v, s], r, a) {
  // u = p, v = a, r = 0, s = 1
  storeFieldIn(u, field.legs.p);
  storeFieldIn(v, a);
  storeFieldIn(r, field.legs.zero);
  storeFieldIn(s, field.legs.one);
  let k = 0;
  for (; !isZero(v); ) {
    k += makeOdd(u, s);
    k += makeOdd(v, r);
    if (isGreater(u, v)) {
      subtractNoReduce(u, u, v);
      addNoReduce(r, r, s);
    } else {
      subtractNoReduce(v, v, u);
      addNoReduce(s, r, s);
    }
  }
  // TODO: this works without r << 1 at the end because k is also not incremented
  // so the invariant a*r = 2^k (mod p) is still true with a factor 2 less on both sides
  return k;
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
 * @param {number} x
 */
function fromMontgomery(x) {
  multiply(x, x, field.legs.one);
  reduceInPlace(x);
}
/**
 *
 * @param {number} x
 */
function toMontgomery(x) {
  multiply(x, x, field.legs.R2mod);
}

/**
 *
 * @param {bigint} x
 * @param {number?} pointer
 * @returns {number}
 */
function fieldToMontgomeryPointer(x, pointer) {
  let xArray = fieldToUint64Array(x);
  if (pointer) {
    writeFieldInto(pointer, xArray);
  } else {
    pointer = storeField(xArray);
  }
  multiply(pointer, pointer, field.legs.R2mod);
  return pointer;
}
/**
 *
 * @param {number[]} scratchSpace
 * @param {number} pointer
 * @returns {bigint}
 */
function fieldFromMontgomeryPointer([tmp], pointer) {
  multiply(tmp, pointer, field.legs.one);
  reduceInPlace(tmp);
  let x = fieldFromUint64Array(readField(tmp));
  return x;
}

/**
 *
 * @param {bigint} x
 * @returns
 */
function fieldToUint64Array(x) {
  let arr = new BigUint64Array(12);
  for (let i = 0; i < 12; i++, x >>= 32n) {
    arr[i] = x & 0xffffffffn;
  }
  return arr;
}

/**
 *
 * @param {BigUint64Array} arr
 * @returns
 */
function fieldFromUint64Array(arr) {
  let x = 0n;
  let bitPosition = 0n;
  for (let i = 0; i < arr.length; i++) {
    x += arr[i] << bitPosition;
    bitPosition += 32n;
  }
  return x;
}

// ---------------------------------------------------------------------

// obsolete JS versions of arithmetic

/**
 *
 * @param {number} x
 * @param {number} k
 */
function rightShiftInPlace(x, k = 1) {
  if (k > 32) throw Error("unimplemented");
  k = BigInt(k);
  let l = 32n - k;
  let xarr = readField(x);
  for (let i = 0; i < 11; i++) {
    xarr[i] = (xarr[i] >> k) | ((xarr[i + 1] << l) & 0xffffffffn);
  }
  xarr[11] = xarr[11] >> k;
  writeFieldInto(x, xarr);
}
/**
 *
 * @param {number} x
 * @param {number} k
 */
function leftShiftInPlace(x, k = 1) {
  if (k > 32) throw Error("unimplemented");
  k = BigInt(k);
  let l = 32n - k;
  let xarr = readField(x);
  for (let i = 10; i >= 0; i--) {
    xarr[i + 1] = (xarr[i] >> l) | ((xarr[i + 1] << k) & 0xffffffffn);
  }
  xarr[0] = (xarr[0] << k) & 0xffffffffn;
  writeFieldInto(x, xarr);
}

function makeOddJs(u, s) {
  let k = 0;
  while (isEven(u)) {
    rightShiftInPlace(u);
    leftShiftInPlace(s);
    k++;
  }
  return k;
}

function almostInverseMontgomeryOriginal([u, v, s], r, a) {
  // u = p, v = a, r = 0, s = 1
  writeFieldInto(u, pLegs);
  storeFieldIn(v, a);
  storeFieldIn(r, field.legs.zero);
  storeFieldIn(s, field.legs.one);
  let k = 0;
  for (; !isZero(v); ) {
    if (isEven(u)) {
      rightShiftInPlace(u);
      leftShiftInPlace(s);
    } else if (isEven(v)) {
      rightShiftInPlace(v);
      leftShiftInPlace(r);
    } else if (isGreater(u, v)) {
      subtractNoReduce(u, u, v);
      rightShiftInPlace(u);
      addNoReduce(r, r, s);
      leftShiftInPlace(s);
    } else {
      subtractNoReduce(v, v, u);
      rightShiftInPlace(v);
      addNoReduce(s, r, s);
      leftShiftInPlace(r);
    }
    k++;
    // let a0 = fieldFromUint64Array(readField(a));
    // let u0 = fieldFromUint64Array(readField(u));
    // let v0 = fieldFromUint64Array(readField(v));
    // let r0 = fieldFromUint64Array(readField(r));
    // let s0 = fieldFromUint64Array(readField(s));
    // if (u0 * s0 + v0 * r0 !== p) throw Error("invariant violated 1");
    // if (mod(a0 * r0, p) !== mod(-u0 * (1n << BigInt(k)), p)) {
    //   throw Error("invariant violated 2");
    // }
    // if (mod(a0 * s0, p) !== mod(v0 * (1n << BigInt(k)), p)) {
    //   throw Error("invariant violated 3");
    // }
  }
  return k;
}

function isEven(x) {
  return (readField(x)[0] & 1n) === 0n;
}
function isGreaterJs(x, y) {
  let xarr = readField(x);
  let yarr = readField(y);
  for (let i = 11; i >= 0; i--) {
    if (xarr[i] > yarr[i]) return true;
    if (xarr[i] < yarr[i]) break;
  }
  return false;
}

/**
 * addition; reduces by -2p if result > 2p
 * @param {number} result where we store x + y
 * @param {number} x
 * @param {number} y
 */
function addNoReduceJs(result, x, y) {
  let x_ = readField(x);
  let y_ = readField(y);
  let t = new BigUint64Array(12);
  let carry = 0n;
  for (let i = 0; i < 12; i++) {
    let tmp = x_[i] + y_[i] + carry;
    t[i] = tmp & 0xffffffffn;
    carry = tmp >> 32n;
  }
  if (carry !== 0n) throw Error("aaaa");
  writeFieldInto(result, t);
}

/**
 * subtraction; adds +2p if result < 0
 * @param {number} result where we store x - y
 * @param {number} x
 * @param {number} y
 */
function subtractNoReduceJs(result, x, y) {
  let x_ = readField(x);
  let y_ = readField(y);
  let t = new BigUint64Array(12);
  let borrow = 0n;
  let m = 0x100000000n;
  for (let i = 0; i < 12; i++) {
    let tmp = x_[i] - y_[i] - borrow + m;
    t[i] = tmp & 0xffffffffn;
    borrow = 1n - (tmp >> 32n);
  }
  if (borrow !== 0n) throw Error("aaaa");
  writeFieldInto(result, t);
}

/**
 * addition; reduces by -2p if result > 2p
 * @param {number} result where we store x + y
 * @param {number} x
 * @param {number} y
 */
function addJs(result, x, y) {
  let x_ = readField(x);
  let y_ = readField(y);
  let t = new BigUint64Array(12);
  let carry = 0n;
  for (let i = 0; i < 12; i++) {
    let tmp = x_[i] + y_[i] + carry;
    t[i] = tmp & 0xffffffffn;
    carry = tmp >> 32n;
  }
  for (let i = 11; i >= 0; i--) {
    if (t[i] < twoPLegs[i]) {
      storeFieldIn(result, t);
      return;
    }
    if (t[i] > twoPLegs[i]) break;
  }
  // if we're here, t >= 2p, so do t - 2p to get back in 0,..,2p-1
  let borrow = 0n;
  let m = 0x100000000n;
  for (let i = 0; i < 12; i++) {
    let tmp = t[i] - twoPLegs[i] - borrow + m;
    t[i] = tmp & 0xffffffffn;
    borrow = 1n - (tmp >> 32n);
  }
  storeFieldIn(result, t);
}

/**
 * subtraction; adds +2p if result < 0
 * @param {number} result where we store x - y
 * @param {number} x
 * @param {number} y
 */
function subtractJs(result, x, y) {
  let x_ = readField(x);
  let y_ = readField(y);
  let t = new BigUint64Array(12);
  let borrow = 0n;
  let m = 0x100000000n;
  for (let i = 0; i < 12; i++) {
    let tmp = x_[i] - y_[i] - borrow + m;
    t[i] = tmp & 0xffffffffn;
    borrow = 1n - (tmp >> 32n);
  }
  if (borrow === 0n) {
    storeFieldIn(result, t);
    return;
  }
  // if we're here, y > x and t = x - y + R, while we want x - y + 2p
  // so do t - (R - 2p)
  borrow = 0n;
  for (let i = 0; i < 12; i++) {
    let tmp = t[i] - Rminus2PLegs[i] - borrow + m;
    t[i] = tmp & 0xffffffffn;
    borrow = 1n - (tmp >> 32n);
  }
  storeFieldIn(result, t);
}

/**
 *
 * @param {number} x
 */
function reduceInPlaceJs(x) {
  let x_ = readField(x);
  for (let i = 11; i >= 0; i--) {
    if (x_[i] < pLegs[i]) return;
    if (x_[i] > pLegs[i]) break;
  }
  // if we're here, x >= p. since we assume x < 2p, we do x - p to reduce
  let borrow = 0n;
  let m = 0x100000000n;
  for (let i = 0; i < 12; i++) {
    let tmp = x_[i] - pLegs[i] - borrow + m;
    x_[i] = tmp & 0xffffffffn;
    borrow = 1n - (tmp >> 32n);
  }
  writeFieldInto(x, x_);
}

/**
 *
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function equalsJs(x, y) {
  let x_ = readField(x);
  let y_ = readField(y);
  for (let i = 0; i < 12; i++) {
    if (x_[i] !== y_[i]) return false;
  }
  return true;
}
/**
 *
 * @param {number} x
 * @returns {boolean}
 */
function isZeroJs(x) {
  let x_ = readField(x);
  for (let i = 0; i < 12; i++) {
    if (x_[i] !== 0n) return false;
  }
  return true;
}

function montgomeryReduction(x, { k, Rm1, p, mu }) {
  // input: x s.t. 0 <= x < p
  // output: (x / R) mod p
  // needs to be done after multiplying xR and yR mod p to bring it back to xyR mod p
  let q = (mu * x) & Rm1;
  let C = (x + p * q) >> k;
  if (C >= p) C = C - p;
  return C;
}

function montgomeryMulSimple(x, y, { k, Rm1, p, mu }) {
  // input: x, y s.t. 0 <= x < p
  // output: (x * y / R) mod p
  // needs to be done when multiplying xR and yR mod p to bring it back to xyR mod p
  let xy = x * y;
  let xy_ = xy & Rm1;
  let muxy = mu * xy_;
  let q = muxy & Rm1;
  let pq = p * q;
  let C = (xy + pq) >> k;
  if (C >= p) C = C - p;
  return C;
}

/**
 *
 * @param {BigUint64Array} x
 * @param {BigUint64Array} y
 * @param {{pArray: BigUint64Array; mu0: bigint}} param2
 * @returns
 */
function montgomeryMul12Leg(x, y, { legs: { p }, mu0 }) {
  // input: x, y s.t. 0 <= x < p
  // output: (x * y / R) mod p
  // needs to be done when multiplying xR and yR mod p to bring it back to xyR mod p
  let q = p;
  let t = new BigUint64Array(12);
  // console.log(mu0);
  // for (let i = 0; i < 12; i++) {
  //   console.log(q[i]);
  // }
  for (let i = 0; i < 12; i++) {
    // console.log(i, t[0]);
    let tmp = t[0] + x[i] * y[0];
    t[0] = tmp & 0xffffffffn;
    let A = tmp >> 32n;
    let m = (t[0] * mu0) & 0xffffffffn;
    let C = (t[0] + m * q[0]) >> 32n;
    for (let j = 1; j < 12; j++) {
      let tmp = t[j] + x[i] * y[j] + A;
      t[j] = tmp & 0xffffffffn;
      A = tmp >> 32n;
      tmp = t[j] + m * q[j] + C;
      t[j - 1] = tmp & 0xffffffffn;
      C = tmp >> 32n;
    }
    t[11] = A + C;
  }
  return t;
}

function montgomeryMul12LegOriginal(X, Y, { pArray, mu0, p }) {
  // input: x, y s.t. 0 <= x < p
  // output: (x * y / R) mod p
  // needs to be done when multiplying xR and yR mod p to bring it back to xyR mod p
  let q = pArray;
  let t = new BigUint64Array(12);
  for (let i = 0; i < 12; i++) {
    // compute t = t + X[i] * Y
    let C = 0n;
    for (let j = 0; j < 12; j++) {
      let tmp = t[j] + X[i] * Y[j] + C;
      t[j] = tmp & 0xffffffffn;
      C = tmp >> 32n;
    }
    let A = C;

    C = 0n;
    let m = (t[0] * mu0) & 0xffffffffn;
    let tmp = t[0] + m * q[0];
    C = tmp >> 32n;
    for (let j = 1; j < 12; j++) {
      let tmp = t[j] + m * q[j] + C;
      t[j - 1] = tmp & 0xffffffffn;
      C = tmp >> 32n;
    }
    t[11] = A + C;
    // console.assert(t[11] >> 32n === 0n);
  }
  // let Rinv = modInverse(1n << 384n, p);
  // let x = fieldFromUint64Array(X);
  // let y = fieldFromUint64Array(Y);
  // let z = fieldFromUint64Array(t);
  // if (z !== mod(x * y * Rinv, p)) {
  //   if (z === mod(x * y * Rinv, p) + p) {
  //     // console.warn("unreduced montgomery multiplication");
  //   } else {
  //     console.error(z);
  //     console.error(mod(x * y * Rinv, p));
  //     console.error(mod(x * y * Rinv, p) + p);
  //     console.error(mod(x * y * Rinv, p) + 2n * p);
  //     throw Error("failed montgomery multiplication");
  //   }
  // }
  return t;
}

/**
 *
 * @param {number[]} scratchSpace
 * @param {number} ainv
 * @param {number} a0
 */
function modInverseMontgomeryJs(scratchSpace, ainv, a0) {
  if (isZero(a0)) throw Error("cannot invert 0");
  let a = fieldFromMontgomeryPointer([ainv], a0);
  let b = field.p;
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
  fieldToMontgomeryPointer(mod(x, field.p), ainv);
}
