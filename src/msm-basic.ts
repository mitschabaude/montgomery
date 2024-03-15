/**
 * MSM implementation that only relies on the most basic curve interface: add, double, zero.
 *
 * We use this for Twisted Edwards curves which have neither endomorphisms nor a cheap batched addition algorithm.
 */
import { MsmField } from "./field-msm.js";
import { Scalar } from "./scalar-simple.js";
import { log2 } from "./util.js";

export { msmBasic };

type MsmInputCurve = {
  Field: MsmField;
  Scalar: Scalar;
  Curve: {
    size: number;
    setZero: (P: number) => void;
    addAssign: (scratch: number[], P1: number, P2: number) => void;
    doubleInPlace: (scratch: number[], P: number) => void;
    copy: (target: number, source: number) => void;
  };
};

async function msmBasic(
  { Field, Scalar, Curve }: MsmInputCurve,
  scalars: number[],
  points: number[],
  N: number
) {
  let b = Scalar.sizeInBits;
  let n = log2(N);
  let c = Math.max(n - 1, 1); // window size
  let K = Math.ceil(b / c);
  let L = 1 << c;

  let { addAssign, doubleInPlace, setZero } = Curve;
  let result = Field.global.getPointer(Curve.size);

  using _g = Field.global.atCurrentOffset;
  using _l = Field.local.atCurrentOffset;
  let scratch = Field.local.getPointers(40);
  let partitionSums = Uint32Array.from(Field.global.getPointers(K, Curve.size));

  for (let k = 0; k < K; k++) {
    using _l = Field.local.atCurrentOffset;
    let runningSum = Field.local.getPointer(Curve.size);
    let triangleSum = Field.local.getPointer(Curve.size);
    let buckets = Uint32Array.from(Field.local.getPointers(L - 1, Curve.size));
    for (let l = 0; l < L - 1; l++) setZero(buckets[l]);

    // accumulation
    for (let i = 0; i < N; i++) {
      let l = Scalar.extractBitSlice(scalars[i], k * c, c);
      if (l === 0) continue;
      addAssign(scratch, buckets[l - 1], points[i]);
    }

    // triangle sum
    setZero(runningSum);
    setZero(triangleSum);
    for (let l = L - 2; l >= 0; l--) {
      addAssign(scratch, runningSum, buckets[l]);
      addAssign(scratch, triangleSum, runningSum);
    }
    Curve.copy(partitionSums[k], triangleSum);
  }

  // final summation
  Curve.copy(result, partitionSums[K - 1]);
  for (let k = K - 2; k >= 0; k--) {
    for (let i = 0; i < c; i++) {
      doubleInPlace(scratch, result);
    }
    addAssign(scratch, result, partitionSums[k]);
  }

  return result;
}
