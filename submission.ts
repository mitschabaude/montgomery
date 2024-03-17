import { Ed377 } from "./src/concrete/ed-on-bls12-377.js";
import { startThreads } from "./src/module-weierstrass.js";

export { compute_msm };

await startThreads();

async function compute_msm(
  inputPoints: BigIntPoint[] | U32ArrayPoint[] | Buffer,
  inputScalars: bigint[] | Uint32Array[] | Buffer
): Promise<{ x: bigint; y: bigint }> {
  // transfer to wasm memory
  let scalars = await scalarsFromBigint(inputScalars as bigint[]);
  let points = await pointsFromBigint(inputPoints as BigIntPoint[]);

  // compute msm
  let { result } = await Ed377.Parallel.msm(
    scalars,
    points,
    inputScalars.length
  );

  // return as affine bigint point
  let resultBigint = Ed377.Curve.toBigint(result);
  return Ed377.Bigint.toAffine(resultBigint);
}

export type BigIntPoint = {
  x: bigint;
  y: bigint;
  t: bigint;
  z: bigint;
};

export type U32ArrayPoint = {
  x: Uint32Array;
  y: Uint32Array;
  t: Uint32Array;
  z: Uint32Array;
};

async function pointsFromBigint(inputPoints: BigIntPoint[]) {
  let { Curve } = Ed377;
  let n = inputPoints.length;
  let pointPtr = await Ed377.Parallel.getPointer(n * Curve.size);
  Ed377.Curve.fromAffineBigints(pointPtr, inputPoints);
  return pointPtr;
}

async function scalarsFromBigint(inputScalars: bigint[]) {
  let n = inputScalars.length;
  let { writeBigint, sizeField: size } = Ed377.Scalar;
  let scalarPtr = await Ed377.Parallel.getScalarPointer(n * size);

  for (let i = 0, si = scalarPtr; i < n; i++, si += size) {
    writeBigint(si, inputScalars[i]);
  }
  return scalarPtr;
}
