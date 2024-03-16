// import {
//   Ed377,
//   TwistedEdwards,
// } from "./build/web/src/concrete/ed-on-bls12-377.js";
import { Ed377, TwistedEdwards } from "./src/concrete/ed-on-bls12-377.js";

export { compute_msm };

await TwistedEdwards.startThreads();

async function compute_msm(
  inputPoints: BigIntPoint[] | U32ArrayPoint[] | Buffer,
  inputScalars: bigint[] | Uint32Array[] | Buffer
): Promise<{ x: bigint; y: bigint }> {
  // transfer to wasm memory
  let scalars = scalarsFromBigint(inputScalars as bigint[]);
  let points = pointsFromBigint(inputPoints as BigIntPoint[]);

  let { result } = await Ed377.Parallel.msm(
    scalars,
    points,
    inputScalars.length
  );

  return Ed377.Bigint.toAffine(Ed377.Curve.toBigint(result));
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

function pointsFromBigint(inputPoints: BigIntPoint[]) {
  let { Field, Curve } = Ed377;
  let n = inputPoints.length;
  let points = Field.global.getPointers(n, Curve.size);

  let { sizeField, writeBigint, toMontgomery } = Field;

  for (let i = 0; i < n; i++) {
    let inputPoint = inputPoints[i];

    let x = points[i];
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
  return points[0];
}

function scalarsFromBigint(inputScalars: bigint[]) {
  let n = inputScalars.length;
  let { writeBigint, sizeField: size } = Ed377.Scalar;
  let scalarPtr = Ed377.Scalar.global.getPointer(n * size);

  for (let i = 0, si = scalarPtr; i < n; i++, si += size) {
    writeBigint(si, inputScalars[i]);
  }
  return scalarPtr;
}
