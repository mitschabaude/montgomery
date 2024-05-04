import { Ed377 } from "./src/concrete/ed-on-bls12-377.js";
import { startThreads } from "./src/parallel.js";

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
  let scalars = scalarsFromBytes(inputScalars as Uint8Array);
  let points = pointsFromBytes(inputPoints as Uint8Array);

  // compute msm
  let { result } = await Ed377.Parallel.msm(scalars, points, n);

  // return as affine bigint point
  let resultBigint = Ed377.Curve.toBigint(result);
  return Ed377.Bigint.toAffine(resultBigint);
}

function pointsFromBytes(inputPoints: Uint8Array) {
  let n = inputPoints.length / 64;
  let { Field, Curve } = Ed377;
  let { size } = Curve;
  let {
    fromPackedBytes,
    sizeField,
    toMontgomery,
    copy,
    multiply,
    memoryBytes,
  } = Field;

  // transfer input bytes to wasm memory
  memoryBytes.set(inputPoints, pointInputPtr);

  for (
    let i = 0, pi = pointPtr, bi = pointInputPtr;
    i < n;
    i++, pi += size, bi += 64
  ) {
    let x = pi;
    let y = x + sizeField;
    let z = y + sizeField;
    let t = z + sizeField;

    fromPackedBytes(x, bi);
    fromPackedBytes(y, bi + 32);

    toMontgomery(x);
    toMontgomery(y);
    copy(z, Field.constants.mg1);
    multiply(t, x, y);
  }
  return pointPtr;
}

function scalarsFromBytes(inputScalars: Uint8Array) {
  let n = inputScalars.length / 32;
  let { fromPackedBytes, sizeField: size } = Ed377.Scalar;

  // transfer input bytes to wasm memory
  Ed377.Scalar.memoryBytes.set(inputScalars, scalarInputPtr);

  for (
    let i = 0, si = scalarPtr, bi = scalarInputPtr;
    i < n;
    i++, si += size, bi += 32
  ) {
    fromPackedBytes(si, bi);
  }
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
  let { Curve } = Ed377;
  let n = inputPoints.length;
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
