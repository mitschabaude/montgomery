import "../src/extra/fix-webcrypto.js";
import {
  PointVectorInput,
  ScalarVectorInput,
  compute_msm,
} from "../src/extra/reference.node.js";
import {
  CompatiblePoint,
  msmProjective,
} from "../src/extra/old-wasm/msm-projective.js";
import { tic, toc } from "../src/extra/tictoc.js";
import {
  Field,
  Scalar,
  CurveAffine,
  CurveProjective,
  Bigint,
} from "../src/concrete/bls12-381.js";
import { mod, modInverse } from "../src/field-util.js";
import { msmAffine, msmBigint } from "../src/msm-bls12-zprize.js";
import { bigintFromBytes } from "../src/util.js";
import { load } from "./store-inputs.js";
import { createMsm } from "../src/msm.js";

let runSlowMsm = false;

let n = Number(process.argv[2] ?? 14);
console.log(`running msm with 2^${n} = ${2 ** n} inputs`);

let p = Field.p;

tic("load inputs & convert to rust");
let points: CompatiblePoint[], scalars: Uint8Array[];
let loaded = await load(n);
points = loaded.points;
scalars = loaded.scalars;
// custom test data
// points = [points[0], points[1]];
// scalars = [bigintToBytes(0n, 32), bigintToBytes(0n, 32)];

let scalarVec = ScalarVectorInput.fromJsArray(scalars);
let pointVec = PointVectorInput.fromJsArray(points);
toc();

tic("msm (rust)");
let [xRefBytes, yRefBytes, zRefBytes] = compute_msm(pointVec, scalarVec);
toc();

let xRefProj = bigintFromBytes(xRefBytes);
let yRefProj = bigintFromBytes(yRefBytes);
let zRefProj = bigintFromBytes(zRefBytes);
let [xRef, yRef] = toAffineFromJacobi(xRefProj, yRefProj, zRefProj);

tic("msm (projective)");
let resultProj = msmProjective(scalars, points);
toc();
let xProjProj = mod(resultProj.x, p);
let yProjProj = mod(resultProj.y, p);
let zProjProj = mod(resultProj.z, p);
let [xProj, yProj] = toAffine(xProjProj, yProjProj, zProjProj);

tic("msm (zprize)");
let { result } = msmAffine(scalars, points);
toc();
let [xAffPacked, yAffPacked] = result;
let xAff = bigintFromBytes(xAffPacked);
let yAff = bigintFromBytes(yAffPacked);

let pointsBigint = points.map((P) => {
  let x = bigintFromBytes(P[0]);
  let y = bigintFromBytes(P[1]);
  let isInfinity = P[2];
  return { x, y, isInfinity };
});
let scalarsBigint = scalars.map((s) => bigintFromBytes(s));
tic("msm (bigint zprize)");
let resultBigint = msmBigint(scalarsBigint, pointsBigint);
toc();
let { x: xBig, y: yBig, isInfinity } = resultBigint;

// consistency with new impl

tic("msm (bigint)");
let resultBigintNew = Bigint.msm(scalarsBigint, pointsBigint);
toc();
let { x: xBigNew, y: yBigNew } = resultBigintNew;

console.log("ref === proj", { x: xRef === xProj, y: yRef === yProj });
console.log("ref === aff", { x: xRef === xAff, y: yRef === yAff });
console.log("ref === big", { x: xRef === xBig, y: yRef === yBig });

console.log("proj === aff", { x: xProj === xAff, y: yProj === yAff });

console.log("ref === big new", { x: xRef === xBigNew, y: yRef === yBigNew });

function toAffine(x: bigint, y: bigint, z: bigint) {
  if (z === 0n) return [0n, 0n, true];
  let zInv = modInverse(z, p);
  return [mod(x * zInv, p), mod(y * zInv, p)];
}
function toAffineFromJacobi(x: bigint, y: bigint, z: bigint) {
  if (z === 0n) return [0n, 0n, true];
  let zInv = modInverse(z, p);
  let zInvSquared = mod(zInv * zInv, p);
  return [mod(x * zInvSquared, p), mod(y * zInvSquared * zInv, p)];
}
