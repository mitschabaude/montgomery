import { BLS12377 } from "./src/concrete/bls12-377.js";
import { startThreads } from "./src/parallel.js";

export { compute_msm };

await startThreads();
let scratch = BLS12377.Field.local.getPointers(20);
let nMax = 1 << 20;

// pointers for data used by msm
let pointPtr = await BLS12377.Parallel.getPointer(nMax * BLS12377.Affine.size);
let scalarPtr = await BLS12377.Parallel.getScalarPointer(
  nMax * BLS12377.Scalar.sizeField
);

// pointers for input data
let pointInputPtr = await BLS12377.Parallel.getPointer(nMax * 2 * 48);
let scalarInputPtr = await BLS12377.Parallel.getScalarPointer(nMax * 32);

async function compute_msm(
  inputPoints: BigIntPoint[] | U32ArrayPoint[] | Buffer,
  inputScalars: bigint[] | Uint32Array[] | Buffer
): Promise<{ x: bigint; y: bigint }> {
  let n = 0;

  // transfer to wasm memory
  if (typeof inputScalars[0] === "bigint") {
    n = inputScalars.length;
    await scalarsFromBigint(inputScalars as bigint[]);
  } else {
    n = inputScalars.length / 32;
    await scalarsFromBytes(inputScalars as Uint8Array);
  }
  if (
    typeof inputPoints[0] === "object" &&
    "x" in inputPoints[0] &&
    typeof inputPoints[0].x === "bigint"
  ) {
    await pointsFromBigint(inputPoints as BigIntPoint[]);
  } else {
    await pointsFromBytes(inputPoints as Uint8Array);
  }
  using _ = BLS12377.Field.local.atCurrentOffset;

  let samePoints =
    n > 1 && BLS12377.Field.isEqual(pointPtr, pointPtr + BLS12377.Affine.size);
  let result: number;

  // compute msm
  if (samePoints) {
    ({ result } = await BLS12377.Parallel.msm(scalarPtr, pointPtr, n));
  } else {
    // if not all points are the same, we use the unsafe version which is faster
    // this is fine in real applications where the points are created in a pseudo-random way
    // and won't accidentally cause a degenerate addition case
    ({ result } = await BLS12377.Parallel.msmUnsafe(scalarPtr, pointPtr, n));
  }

  // return as affine bigint point
  let resultAffine = BLS12377.Field.local.getPointer(BLS12377.Affine.size);
  BLS12377.Projective.toAffine(scratch, resultAffine, result);
  let resultBigint = BLS12377.Affine.toBigint(resultAffine);

  return resultBigint;
}

async function pointsFromBytes(inputPoints: Uint8Array) {
  let n = inputPoints.length / (2 * 48);

  // transfer input bytes to wasm memory
  BLS12377.Field.memoryBytes.set(inputPoints, pointInputPtr);

  // in parallel, convert input bytes to point representation
  await BLS12377.Parallel.pointsFromBytes(pointPtr, pointInputPtr, n);
}

async function scalarsFromBytes(inputScalars: Uint8Array) {
  let n = inputScalars.length / 32;

  // transfer input bytes to wasm memory
  BLS12377.Scalar.memoryBytes.set(inputScalars, scalarInputPtr);

  // in parallel, convert input bytes to scalar representation
  await BLS12377.Parallel.scalarsFromBytes(scalarPtr, scalarInputPtr, n);
}

export type BigIntPoint = { x: bigint; y: bigint; isZero: boolean };
export type U32ArrayPoint = { x: Uint32Array; y: Uint32Array };

async function pointsFromBigint(inputPoints: BigIntPoint[]) {
  let { Affine } = BLS12377;
  Affine.writeBigints(pointPtr, inputPoints);
}

async function scalarsFromBigint(inputScalars: bigint[]) {
  let n = inputScalars.length;
  let { writeBigint, sizeField: size } = BLS12377.Scalar;

  for (let i = 0, si = scalarPtr; i < n; i++, si += size) {
    writeBigint(si, inputScalars[i]);
  }
}
