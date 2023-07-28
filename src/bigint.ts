import { BigintPoint, MsmCurve } from "./msm.js";

export { createBigintApi };

type BigintPointProjective = {
  x: bigint;
  y: bigint;
  z: bigint;
};

function createBigintApi({
  Field,
  Scalar,
  CurveAffine,
  CurveProjective,
}: MsmCurve) {
  function randomPoints(n: number, { montgomery = false } = {}) {
    let sizeField = Field.sizeField;
    let memoryOffset = Field.getOffset();
    let points = Field.getZeroPointers(n, CurveAffine.sizeAffine);
    let scratch = Field.getPointers(20);
    CurveAffine.randomPoints(scratch, points);
    let pointsBigint: BigintPoint[] = Array(n);
    for (let i = 0; i < n; i++) {
      let point = points[i];
      let x = point;
      let y = point + sizeField;
      if (!montgomery) {
        Field.fromMontgomery(x);
        Field.fromMontgomery(y);
      } else {
        Field.reduce(x);
        Field.reduce(y);
      }
      pointsBigint[i] = {
        x: Field.readBigint(x),
        y: Field.readBigint(y),
        isInfinity: false,
      };
    }
    Field.setOffset(memoryOffset);
    return pointsBigint;
  }

  function randomPointsProjective(
    n: number,
    options?: { montgomery?: boolean }
  ) {
    let points = randomPoints(n, options);
    let pointsProjective: BigintPointProjective[] = Array(n);
    for (let i = 0; i < n; i++) {
      let { x, y } = points[i];
      pointsProjective[i] = { x, y, z: 1n };
    }
    return pointsProjective;
  }

  return {
    randomPoints,
    randomPointsProjective,
  };
}
