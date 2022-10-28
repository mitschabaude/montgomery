// import {
//   PointVectorInput,
//   ScalarVectorInput,
//   compute_msm,
// } from "./src/reference.js";
import { tic, toc } from "./src/tictoc.web.js";
import { load } from "./src/store-inputs.web.js";
import { msmAffine } from "./src/curve-affine.js";
import { randomBaseFieldx2 } from "./src/finite-field-js.js";
import {
  benchInverse,
  benchMultiply,
  getPointer,
  writeBigint,
} from "./src/finite-field.js";

let n = 16;
console.log(`running msm with 2^${n} inputs`);

tic("load inputs & convert to rust");
let { points, scalars } = await load(n);
// let pointVec = PointVectorInput.fromJsArray(points);
// let scalarVec = ScalarVectorInput.fromJsArray(points);
toc();

tic("warm-up JIT compiler with fixed points");
msmAffine(scalars, points);
// await new Promise((r) => setTimeout(r, 100));
// msmAffine(scalars, points);
toc();
await new Promise((r) => setTimeout(r, 100));

// // benchmark raw mod mul
// let x0 = randomBaseFieldx2();
// let x = getPointer();
// writeBigint(x, x0);
// let nMulRaw = 1e6;
// tic("raw mul x 10M");
// benchMultiply(x, nMulRaw);
// let timeMul = toc();
// let mPerSec = Math.round(nMulRaw / timeMul);

// // benchmark inverse
// let nInvRaw = 5e3;
// tic("raw inv x 50K");
// benchInverse(nInvRaw);
// let timeInv = toc();
// let invPerSec = Math.round(nInvRaw / timeInv);
// let mulPerInv = mPerSec / invPerSec;

// tic("msm (rust)");
// compute_msm(pointVec, scalarVec);
// toc();

tic("msm (ours)");
let { nMul1, nMul2, nMul3, nInv } = msmAffine(scalars, points);
let ours = toc();

let nMul = nMul1 + nMul2 + nMul3;
// let nonMulOverhead = 1 - nMul / mPerSec / ours;

// console.log(`
// # muls:
//   stage 1: ${(1e-6 * nMul1).toFixed(3).padStart(6)} M
//   stage 2: ${(1e-6 * (nMul2 + nMul3)).toFixed(3).padStart(6)} M
//   total:   ${(1e-6 * nMul).toFixed(3).padStart(6)} M

// # inv:     ${(1e-3 * nInv).toFixed(3).padStart(6)} K
//         ~= ${(1e-6 * mulPerInv * nInv).toFixed(3).padStart(6)} M

// ~total     ${(1e-6 * (mulPerInv * nInv + nMul)).toFixed(3).padStart(6)} M

// raw muls / s: ${(1e-6 * mPerSec).toFixed(2)} M
// non-mul overhead: ${(100 * nonMulOverhead).toFixed(1)}%
// 1 inv = ${mulPerInv.toFixed(1)} mul
// `);
