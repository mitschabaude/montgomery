import { Ed377 } from "../../src/concrete/ed-on-bls12-377.js";
import { startThreads } from "../../src/parallel.js";

export { compute_msm };

await startThreads();
let nMax = 1 << 20;

// pointers for data used by msm
let pointPtr = await Ed377.Parallel.getPointer(nMax * Ed377.Curve.size);
let scalarPtr = await Ed377.Parallel.getScalarPointer(
  nMax * Ed377.Scalar.sizeField
);

// pointers for input data
let pointInputPtr = await Ed377.Parallel.getPointer(nMax * 2 * 32);
let scalarInputPtr = await Ed377.Parallel.getScalarPointer(nMax * 32);

async function compute_msm(
  inputPoints: BigIntPoint[] | U32ArrayPoint[] | Buffer,
  inputScalars: bigint[] | Uint32Array[] | Buffer
): Promise<{ x: bigint; y: bigint }> {
  let n = inputScalars.length / 32;

  // transfer to wasm memory
  let scalars = await scalarsFromBytes(inputScalars as Uint8Array);
  let points = await pointsFromBytes(inputPoints as Uint8Array);

  // compute msm
  let { result } = await Ed377.Parallel.msm(scalars, points, n);

  // return as affine bigint point
  let resultBigint = Ed377.Curve.toBigint(result);
  return Ed377.Bigint.toAffine(resultBigint);
}

async function pointsFromBytes(inputPoints: Uint8Array) {
  let n = inputPoints.length / 64;

  // transfer input bytes to wasm memory
  Ed377.Field.memoryBytes.set(inputPoints, pointInputPtr);

  // in parallel, convert input bytes to point representation
  await Ed377.Parallel.pointsFromBytes(pointPtr, pointInputPtr, n);

  return pointPtr;
}

async function scalarsFromBytes(inputScalars: Uint8Array) {
  let n = inputScalars.length / 32;

  // transfer input bytes to wasm memory
  Ed377.Scalar.memoryBytes.set(inputScalars, scalarInputPtr);

  // in parallel, convert input bytes to scalar representation
  await Ed377.Parallel.scalarsFromBytes(scalarPtr, scalarInputPtr, n);

  return scalarPtr;
}

type BigIntPoint = { x: bigint; y: bigint; t: bigint; z: bigint };
type U32ArrayPoint = {
  x: Uint32Array;
  y: Uint32Array;
  t: Uint32Array;
  z: Uint32Array;
};

function pointsFromBigint(inputPoints: BigIntPoint[]) {
  Ed377.Curve.fromAffineBigints(pointPtr, inputPoints);
  return pointPtr;
}

function scalarsFromBigint(inputScalars: bigint[]) {
  let n = inputScalars.length;
  let { writeBigint, sizeField: size } = Ed377.Scalar;

  for (let i = 0, si = scalarPtr; i < n; i++, si += size) {
    writeBigint(si, inputScalars[i]);
  }
  return scalarPtr;
}
