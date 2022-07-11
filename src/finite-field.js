import { randomBytes } from "./builtin-crypto.js";
import { bigintFromBytes, bigintToBits } from "./util.js";
import {
  multiply as multiplyWasm,
  readField,
  storeField,
  storeFieldIn,
  freeField,
  emptyField,
  reset,
} from "./finite-field.wat.js";

export {
  randomScalars,
  randomBaseField,
  randomBaseFieldWasm,
  mod,
  field,
  modSqrt,
  modExp,
  add,
  subtract,
  isZero,
  equals,
  fieldToUint64Array,
  fieldFromUint64Array,
  fieldToMontgomeryPointer,
  fieldFromMontgomeryPointer,
};

function multiply(...args) {
  multiplyWasm(...args);
  reset();
}

let scalar = {
  p: 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n,
  bits: 255,
  bytes: 32,
  // montgomery stuff
  R: 1n << 256n, // montgomery radix 2^k
  Rm1: (1n << 256n) - 1n, // for &ing
  k: 256n,
};
scalar.mu = modInverse(-scalar.p, scalar.R);
scalar.mu0 = modInverse(-scalar.p, 1n << 32n);
scalar.Rmod = mod(scalar.R, scalar.p);
scalar.R2mod = mod(scalar.R * scalar.R, scalar.p);

let field = {
  p: 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn,
  t: 0xd0088f51cbff34d258dd3db21a5d66bb23ba5c279c2895fb39869507b587b120f55ffff58a9ffffdcff7fffffffd555n,
  bits: 381,
  bytes: 48,
  R: 1n << 384n, // montgomery radix 2^k
  Rm1: (1n << 384n) - 1n, // for &ing
  k: 384n,
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
};

let pLegs = fieldToUint64Array(field.p);
let twoPLegs = fieldToUint64Array(2n * field.p);
let Rminus2PLegs = fieldToUint64Array(field.R - 2n * field.p);

/**
 * addition; reduces by -2p if result > 2p
 * @param {number} result where we store x + y
 * @param {number} x
 * @param {number} y
 */
function add(result, x, y) {
  let x_ = readField(x);
  let y_ = readField(y);
  let t = new BigUint64Array(12);
  let carry = 0n;
  for (let i = 0; i < 12; i++) {
    let tmp = x_[i] + y_[i] + carry;
    t[i] = tmp & 0xffffffffn;
    carry = tmp >>= 32n;
  }
  for (let i = 11; i >= 0; i--) {
    if (t[i] < twoPLegs[i]) {
      storeFieldIn(t, result);
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
    borrow = 1n - (tmp >>= 32n);
  }
  storeFieldIn(t, result);
}

/**
 * subtraction; adds +2p if result < 0
 * @param {number} result where we store x - y
 * @param {number} x
 * @param {number} y
 */
function subtract(result, x, y) {
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
    storeFieldIn(t, result);
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
  storeFieldIn(t, result);
}

function reduceInPlace(x) {
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
    borrow = 1n - (tmp >>= 32n);
  }
  storeFieldIn(x_, x);
}

function equals(x, y) {
  let x_ = readField(x);
  let y_ = readField(y);
  for (let i = 0; i < 12; i++) {
    if (x_[i] !== y_[i]) return false;
  }
  return true;
}
function isZero(x) {
  let x_ = readField(x);
  for (let i = 0; i < 12; i++) {
    if (x_[i] !== 0n) return false;
  }
  return true;
}

// let x = randomBaseField() + randomBaseField();
// let y = randomBaseField() + randomBaseField();
// let t = new BigUint64Array(12);
// subtract(t, fieldToUint64Array(x), fieldToUint64Array(y));
// console.log(fieldFromUint64Array(t));
// console.log(x - y > 0n ? x - y : x - y + 2n * field.p);
// console.log(x + y > 2n * field.p ? x + y - 2n * field.p : x + y);

function randomScalars(n) {
  let N = n * 32 * 2;
  let bytes = randomBytes(N);
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

function randomBaseField() {
  while (true) {
    let bytes = randomBytes(48);
    bytes[47] &= 0x1f;
    let x = bigintFromBytes(bytes);
    if (x < field.p) return x;
  }
}

function randomBaseFieldWasm() {
  return storeField(fieldToUint64Array(randomBaseField()));
}

function mod(x, p) {
  x = x % p;
  return x < 0n ? x + p : x;
}

let fieldPlus1Div4 = bigintToBits((field.p + 1n) / 4n, field.bits);

function modSqrt(root, x) {
  // let root0 = modExp(fieldFromMontgomeryPointer(x), (field.p + 1n) / 4n, field);
  modExpMontgomery(root, x, fieldPlus1Div4);
  // if (root0 !== fieldFromMontgomeryPointer(root)) throw Error("not equal");

  let tmp = emptyField();
  multiply(tmp, root, root);
  reduceInPlace(tmp);
  reduceInPlace(x);
  if (!equals(tmp, x)) {
    freeField(tmp);
    return;
  }
  freeField(tmp);
  return root;
}

/**
 *
 * @param {number} a
 * @param {boolean[]} nBits
 * @returns {number} x
 */
function modExpMontgomery(x, a0, nBits) {
  let { Rmod } = field.legs;
  storeFieldIn(readField(Rmod), x); // 1R
  let a = storeField(readField(a0));
  for (let bit of nBits) {
    if (bit) {
      multiply(x, x, a);
    }
    multiply(a, a, a);
  }
  freeField(a);
}

/**
 *
 * @param {bigint} a0
 * @param {boolean[]} nBits
 * @param {any} field
 * @returns {bigint}
 */
function modExpMontgomery_(a0, nBits, field) {
  let { p } = field;
  let { Rmod, R2mod, one } = field.legs;
  a0 = mod(a0, p);
  let a = storeField(fieldToUint64Array(a0));
  multiply(a, a, R2mod); // aR
  let x = storeField(readField(Rmod)); // 1R
  for (let bit of nBits) {
    if (bit) {
      multiply(x, x, a);
    }
    multiply(a, a, a);
  }
  // now x = a^n*R mod p -> convert back to a^n mod p
  multiply(x, x, one);
  let x0 = fieldFromUint64Array(readField(x));
  freeField(x);
  freeField(a);
  if (x0 >= p) x0 = x0 - p;
  return x0;
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

function fieldToMontgomeryPointer(x) {
  let x0 = storeField(fieldToUint64Array(x));
  multiply(x0, x0, field.legs.R2mod);
  return x0;
}
function fieldFromMontgomeryPointer(x0) {
  let x1 = emptyField();
  multiply(x1, x0, field.legs.one);
  reduceInPlace(x1);
  let x = fieldFromUint64Array(readField(x1));
  freeField(x1);
  return x;
}

function fieldToUint64Array(x) {
  let arr = new BigUint64Array(12);
  for (let i = 0; i < 12; i++, x >>= 32n) {
    arr[i] = x & 0xffffffffn;
  }
  return arr;
}

function fieldFromUint64Array(arr) {
  let x = 0n;
  let bitPosition = 0n;
  for (let i = 0; i < arr.length; i++) {
    x += arr[i] << bitPosition;
    bitPosition += 32n;
  }
  return x;
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
