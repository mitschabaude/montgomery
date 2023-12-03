// run with ts-node-esm
import "../src/extra/fix-webcrypto.js";
import { BLS12_377 } from "../src/index.js";
import {
  assert,
  bigintToBits,
  extractBitSlice as extractBitSliceJS,
  randomBytes,
} from "../src/util.js";
import { mod, modExp, modInverse } from "../src/field-util.js";
import { G, q } from "../src/concrete/bls12-377.params.js";
import { tic, toc } from "../src/extra/tictoc.js";

let { Field, Scalar, CurveAffine, CurveProjective, Random } = BLS12_377;
const { p } = Field;

function toWasm(x0: bigint, x: number) {
  Field.writeBigint(x, x0);
  Field.toMontgomery(x);
}
function ofWasm([tmp]: number[], x: number) {
  Field.multiply(tmp, x, Field.constants.one);
  Field.reduce(tmp);
  return mod(Field.readBigint(tmp), p);
}

let [x, y, z, z_hi, ...scratch] = Field.getPointers(40);
let scratchScalar = Scalar.getPointers(10);

let R = mod(1n << BigInt(Field.w * Field.n), p);
let Rinv = modInverse(R, p);

function test() {
  let x0 = Random.randomFieldx2();
  let y0 = Random.randomFieldx2();
  toWasm(x0, x);
  toWasm(y0, y);

  // multiply
  let z0 = mod(x0 * y0, p);
  Field.multiply(z, x, y);
  let z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("multiply");
  z0 = 0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn; // test overflow resistance
  toWasm(z0, z);
  z0 = mod(z0 * z0, p);
  Field.multiply(z, z, z);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("multiply");

  // square
  z0 = mod(x0 * x0, p);
  Field.square(z, x);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("square");

  // leftShift
  let k = 97;
  z0 = 1n << BigInt(k);
  // computes R^2 * 2^k / R = 2^k R, which is 2^k in montgomery form
  Field.leftShift(z, Field.constants.R2, k);
  z1 = ofWasm(scratch, z);
  if (z1 !== z0) throw Error("leftShift");

  // add
  z0 = mod(x0 + y0, p);
  Field.add(z, x, y);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("add");

  // subtract
  z0 = mod(x0 - y0, p);
  Field.subtract(z, x, y);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("subtract");

  // subtract plus 2p
  z0 = mod(x0 - y0, p);
  Field.subtractPositive(z, x, y);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("subtract");

  // reduceInPlace
  z0 = x0 >= p ? x0 - p : x0;
  Field.copy(z, x);
  Field.reduce(z);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("reduceInPlace");

  // isEqual
  if (Field.isEqual(x, x) !== 1) throw Error("isEqual");
  if (Field.isEqual(x, y) !== 0) throw Error("isEqual");

  // inverse
  Field.inverse(scratch[0], z, x);
  Field.multiply(z, z, x);
  z1 = ofWasm(scratch, z);
  if (z1 !== 1n) throw Error("inverse");
  z0 = modInverse(x0, p);
  if (mod(z0 * x0, p) !== 1n) throw Error("inverse");

  // sqrt
  let exists0 = modExp(x0, (p - 1n) >> 1n, { p }) === 1n;
  let exists1 = Field.sqrt(scratch, z, x);
  if (exists0 !== exists1) throw Error("isSquare");
  if (exists0) {
    let zsqrt = ofWasm(scratch, z);
    Field.square(z, z);
    z0 = ofWasm(scratch, z);
    if (mod(zsqrt * zsqrt - x0, p) !== 0n) throw Error("sqrt");
    if (mod(z0 - x0, p) !== 0n) throw Error("sqrt");
  }

  // roots
  let minus1 = Field.roots.at(-1)!;
  if (Field.toBigint(minus1) !== p - 1n) throw Error("roots");

  // makeOdd
  Field.writeBigint(x, 5n << 120n);
  Field.writeBigint(z, 3n);
  Field.makeOdd(x, z);
  x0 = Field.readBigint(x);
  z0 = Field.readBigint(z);
  if (!(x0 === 5n && z0 === 3n << 120n)) throw Error("makeOdd");

  // extractBitSlice
  let arr = new Uint8Array([0b0010_0110, 0b1101_0101, 0b1111_1111]);
  let e = Error("extractBitSlice");
  if (extractBitSliceJS(arr, 2, 4) !== 0b10_01) throw e;
  if (extractBitSliceJS(arr, 0, 2) !== 0b10) throw e;
  if (extractBitSliceJS(arr, 0, 8) !== 0b0010_0110) throw e;
  if (extractBitSliceJS(arr, 3, 9) !== 0b0101_0010_0) throw e;
  if (extractBitSliceJS(arr, 8, 8) !== 0b1101_0101) throw e;
  if (extractBitSliceJS(arr, 5, 3 + 8 + 2) !== 0b11_1101_0101_001) throw e;
  if (extractBitSliceJS(arr, 16, 10) !== 0b1111_1111) throw e;

  // extractBitSlice (wasm)
  let s = Scalar.getPointer();
  Scalar.writeBytes(scratchScalar, s, arr);
  const { extractBitSlice } = Scalar;
  e = Error("extractBitSlice (wasm)");
  if (extractBitSlice(s, 2, 4) !== 0b10_01) throw e;
  if (extractBitSlice(s, 0, 2) !== 0b10) throw e;
  if (extractBitSlice(s, 0, 8) !== 0b0010_0110) throw e;
  if (extractBitSlice(s, 3, 9) !== 0b0101_0010_0) throw e;
  if (extractBitSlice(s, 8, 8) !== 0b1101_0101) throw e;
  if (extractBitSlice(s, 5, 3 + 8 + 2) !== 0b11_1101_0101_001) throw e;
  if (extractBitSlice(s, 16, 10) !== 0b1111_1111) throw e;
}

for (let i = 0; i < 100; i++) {
  test();
  testCurve();
}
for (let i = 0; i < 100; i++) {
  let ok = Scalar.testDecomposeScalar(Random.randomScalar());
  if (!ok) throw Error("scalar decomposition");
}

testBatchMontgomery();

function testBatchMontgomery() {
  let n = 1000;
  let X = Field.getPointers(n);
  let invX = Field.getPointers(n);
  let scratch = Field.getPointers(10);
  for (let i = 0; i < n; i++) {
    let x0 = Random.randomFieldx2();
    Field.writeBigint(X[i], x0);
    // compute inverses normally
    Field.inverse(scratch[0], invX[i], X[i]);
  }
  // compute inverses as batch
  let invX1 = Field.getPointers(n);
  Field.batchInverse(scratch[0], invX1[0], X[0], n);

  // check that all inverses are equal
  for (let i = 0; i < n; i++) {
    let z0 = Field.readBigint(invX[i]);
    let z1 = Field.readBigint(invX1[i]);
    if (mod(z1 - z0, p) !== 0n) throw Error("batch inverse");

    Field.reduce(invX1[i]);
    Field.reduce(invX[i]);
    if (!Field.isEqual(invX1[i], invX[i])) {
      console.log({
        i,
        z0,
        z1,
        invX0: Field.readBigint(invX[i]),
        invX1: Field.readBigint(invX1[i]),
      });
      throw Error("batch inverse / reduce");
    }
  }
}

function testCurve() {
  // prepare inputs
  let [g, qG] = Field.getPointers(2, CurveAffine.sizeAffine);
  CurveAffine.writeBigint(g, G);
  let qBits = bigintToBits(q);

  // scale and check
  CurveAffine.scale(scratch, qG, g, qBits);
  assert(CurveAffine.isZeroAffine(qG), "order*G = 0");

  // create random point and check if it is in the subgroup
  let [r, qR] = Field.getPointers(2, CurveAffine.sizeAffine);
  CurveAffine.randomPoints(scratch, [r]);
  assert(!CurveAffine.isZeroAffine(r), "random point R is not zero");
  CurveAffine.scale(scratch, qR, r, qBits);
  assert(CurveAffine.isZeroAffine(qR), "order*h*R = 0");
}

// fast random point generation

tic("random point generation");
let n = 1 << 16; // number of points to generate
let entropy = 128; // number of random bits we generate each point from

// split entropy into k windows of size c
let c = 13;
let K = Math.ceil(entropy / c);
console.log({ c, K, actualEntropy: c * K });

// 1. generate a random basis of size k
tic("random basis");
let basis = Field.getPointers(K, CurveAffine.sizeAffine);
CurveAffine.randomPoints(scratch, basis);
toc();

// 2. precompute multiples of each basis point: G, ..., 2^c*G
tic("precompute multiples");
let L = 1 << c;
let B = basis.map((Bk1) => {
  let Bk = Field.getPointers(L, CurveProjective.sizeProjective);

  // zeroth point is zero
  CurveProjective.setZero(Bk[0]);
  // first point is the basis point
  CurveProjective.affineToProjective(Bk[1], Bk1);
  // second needs double
  CurveProjective.copy(Bk[2], Bk[1]);
  CurveProjective.doubleInPlace(scratch, Bk[2]);
  // the rest with additions
  for (let l = 3; l < L; l++) {
    CurveProjective.copy(Bk[l], Bk[l - 1]);
    CurveProjective.addAssign(scratch, Bk[l], Bk[1]);
  }
  return Bk;
});
toc();

// 3. generate random points by taking a sum of random basis multiples
tic("random points");
let points = Field.getPointers(n, CurveProjective.sizeProjective);

for (let i = 0; i < n; i++) {
  let windows = randomWindows(c, K);
  let P = points[i];
  CurveProjective.copy(P, B[0][windows[0]]);
  for (let k = 1; k < K; k++) {
    let l = windows[k];
    CurveProjective.addAssign(scratch, P, B[k][l]);
  }
}
toc();

// 4. convert to affine
tic("convert to affine");
let pointsAffine = Field.getPointers(n, CurveAffine.sizeAffine);
for (let i = 0; i < n; i++) {
  CurveProjective.projectiveToAffine(scratch, pointsAffine[i], points[i]);
}
toc();
toc();

// console.log(pointsAffine.map((P) => CurveAffine.toBigint(P)));

function randomWindows(c: number, K: number) {
  assert(c <= 16, "can generate a window from 2 bytes");
  let cMask = (1 << c) - 1;
  let windows: number[] = new Array(K);
  let bytes = randomBytes(2 * K);
  for (let k = 0; k < K; k++) {
    windows[k] = (bytes[2 * k] + 256 * bytes[2 * k + 1]) & cMask;
  }
  return windows;
}
