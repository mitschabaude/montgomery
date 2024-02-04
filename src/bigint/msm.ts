/**
 * Simple bigint implementation pippenger MSM,
 * generic over the curve.
 */

import { assert, log2 } from "../util.js";

export { msm };

function msm<Point>(
  Curve: InputCurve<Point>,
  scalars: bigint[],
  points: Point[]
) {
  let N = scalars.length;
  assert(N === points.length, "matching length");
  let b = Curve.Scalar.sizeInBits;
  let c = Math.max(log2(N) - 1, 1); // window size
  let cMask = (1 << c) - 1;
  let K = Math.ceil(b / c);
  let L = 1 << c;
  console.log({ scalars });

  let partitionSums: Point[] = Array(K);

  for (let k = 0; k < K; k++) {
    let buckets: Point[] = Array(L);
    for (let l = 0; l < L; l++) {
      buckets[l] = Curve.zero;
    }

    for (let i = 0; i < N; i++) {
      let l = Number(scalars[i] >> BigInt(k * c)) & cMask;
      buckets[l] = Curve.add(buckets[l], points[i]);
    }

    if (k === 0) console.log({ k, buckets });

    let runningSum = Curve.zero;
    let triangleSum = Curve.zero;
    for (let l = 1; l < L; l++) {
      runningSum = Curve.add(runningSum, buckets[l]);
      triangleSum = Curve.add(triangleSum, runningSum);
    }

    partitionSums[k] = triangleSum;
  }

  let result = partitionSums[K - 1];
  for (let k = K - 2; k >= 0; k--) {
    for (let i = 0; i < c; i++) {
      result = Curve.double(result);
    }
    result = Curve.add(result, partitionSums[k]);
  }

  return result;
}

type InputCurve<Point> = {
  zero: Point;
  add: (P: Point, Q: Point) => Point;
  double: (P: Point) => Point;
  Scalar: {
    sizeInBits: number;
  };
};
