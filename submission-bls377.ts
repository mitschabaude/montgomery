import { BLS12377, Weierstraß } from "./src/concrete/bls12-377.js";

export { compute_msm };

await Weierstraß.startThreads();
let scratch = BLS12377.Field.local.getPointers(20);

async function compute_msm(
  inputPoints: BigIntPoint[] | U32ArrayPoint[] | Buffer,
  inputScalars: bigint[] | Uint32Array[] | Buffer
): Promise<{ x: bigint; y: bigint }> {
  // transfer to wasm memory
  let scalars = await scalarsFromBigint(inputScalars as bigint[]);
  let points = await pointsFromBigint(inputPoints as BigIntPoint[]);

  // compute msm
  // IMPORTANT: we use `msmUnsafe`, which doesn't handle all edge cases of inputs, but is faster.
  // this is fine in the typical application scenario where the points are guaranteed to have been
  // created in a pseudo-random way and observe no simple algebraic relationships with each other.
  // if exhibiting these edge cases in tests, as a fallback we can replace the line below with
  // let { result } = await BLS12377.Parallel.msm(
  let { result } = await BLS12377.Parallel.msmUnsafe(
    scalars,
    points,
    inputScalars.length
  );

  // return as affine bigint point
  let resultAffine = BLS12377.Field.local.getPointer(BLS12377.Affine.size);
  BLS12377.Projective.toAffine(scratch, resultAffine, result);
  let resultBigint = BLS12377.Affine.toBigint(resultAffine);

  return resultBigint;
}

export type BigIntPoint = { x: bigint; y: bigint; isZero: boolean };
export type U32ArrayPoint = { x: Uint32Array; y: Uint32Array };

async function pointsFromBigint(inputPoints: BigIntPoint[]) {
  let { Affine } = BLS12377;
  let n = inputPoints.length;
  let pointPtr = await BLS12377.Parallel.getPointer(n * Affine.size);
  Affine.writeBigints(pointPtr, inputPoints);
  return pointPtr;
}

async function scalarsFromBigint(inputScalars: bigint[]) {
  let n = inputScalars.length;
  let { writeBigint, sizeField: size } = BLS12377.Scalar;
  let scalarPtr = await BLS12377.Parallel.getScalarPointer(n * size);

  for (let i = 0, si = scalarPtr; i < n; i++, si += size) {
    writeBigint(si, inputScalars[i]);
  }
  return scalarPtr;
}
