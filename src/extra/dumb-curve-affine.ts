import { mod } from "../bigint/field-util.js";
import { inverse } from "../bigint/field.js";
import type { BigintPoint } from "../msm.js";
import { assert, bigintToBits } from "../util.js";

export { msmDumbAffine, doubleAffine, addAffine, scale, checkOnCurve };

function msmDumbAffine(
  scalars: bigint[],
  points: BigintPoint[],
  Scalar: { sizeInBits: number },
  Field: { p: bigint }
) {
  let n = points.length;
  let scalarsBits = scalars.map((s) => bigintToBits(s, Scalar.sizeInBits));
  let sum = zero;
  for (let i = 0; i < n; i++) {
    let s = scalarsBits[i];
    let P = points[i];
    let Q = scale(s, P, Field.p);
    // console.log("scale result", Q);
    sum = addAffine(sum, Q, Field.p);
  }
  return sum;
}

const zero: BigintPoint = { x: 0n, y: 0n, isInfinity: true };

function addAffine(G: BigintPoint, H: BigintPoint, p: bigint): BigintPoint {
  if (G.isInfinity) return H;
  if (H.isInfinity) return G;

  let { x: x1, y: y1 } = G;
  let { x: x2, y: y2 } = H;

  if (x1 === x2) {
    // G + G --> we double
    if (y1 === y2) return doubleAffine(G, p);
    // G - G --> return zero
    if (y1 === p - y2) return zero;
    assert(false, "unreachable");
  }
  // m = (y2 - y1)/(x2 - x1)
  let d = inverse(x2 - x1, p);
  let m = mod((y2 - y1) * d, p);
  // x3 = m^2 - x1 - x2
  let x3 = mod(m * m - x1 - x2, p);
  // y3 = m*(x1 - x3) - y1
  let y3 = mod(m * (x1 - x3) - y1, p);
  return { x: x3, y: y3, isInfinity: false };
}

function doubleAffine(
  { x, y, isInfinity }: BigintPoint,
  p: bigint
): BigintPoint {
  if (isInfinity) zero;
  // m = 3*x^2 / 2y
  let d = inverse(2n * y, p);
  let m = mod(3n * x * x * d, p);
  // x2 = m^2 - 2x
  let x2 = mod(m * m - 2n * x, p);
  // y2 = m*(x - x2) - y
  let y2 = mod(m * (x - x2) - y, p);
  return { x: x2, y: y2, isInfinity: false };
}

function checkOnCurve({ x, y, isInfinity }: BigintPoint, p: bigint, b: bigint) {
  if (isInfinity) return true;
  return mod(x * mod(x * x, p) + b - y * y, p) === 0n;
}

function scale(scalar: boolean[], point: BigintPoint, p: bigint) {
  let result = zero;
  let n = scalar.length;
  for (let i = 0; i < n - 1; i++) {
    if (scalar[i]) result = addAffine(result, point, p);
    point = doubleAffine(point, p);
  }
  if (scalar[n - 1]) result = addAffine(result, point, p);
  return result;
}
