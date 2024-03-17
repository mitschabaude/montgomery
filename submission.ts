import { Ed377, TwistedEdwards } from "./src/concrete/ed-on-bls12-377.js";

export { compute_msm };

await TwistedEdwards.startThreads();

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
  let { Field, Curve } = Ed377;
  let n = inputPoints.length;
  let pointPtr = await Ed377.Parallel.getPointer(n * Curve.size);

  let { sizeField, writeBigint, toMontgomery } = Field;

  for (let i = 0, pi = pointPtr; i < n; i++, pi += Curve.size) {
    let inputPoint = inputPoints[i];

    let x = pi;
    let y = x + sizeField;
    let z = y + sizeField;
    let t = z + sizeField;

    writeBigint(x, inputPoint.x);
    writeBigint(y, inputPoint.y);

    toMontgomery(x);
    toMontgomery(y);
    Field.copy(z, Field.constants.mg1);
    Field.multiply(t, x, y);
  }
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
