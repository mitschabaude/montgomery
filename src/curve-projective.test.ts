import { BigintPoint } from "./bigint/projective-weierstrass.js";
import { pallasParams as curveParams } from "./concrete/pasta.params.js";
import { createCurveProjective } from "./curve-projective.js";
import { createMsmField } from "./field-msm.js";
import {
  WasmSpec,
  createEquivalentWasm,
  wasmSpec,
} from "./testing/equivalent-wasm.js";
import { Spec, spec, throwError } from "./testing/equivalent.js";
import { Random, sample } from "./testing/random.js";
import { bigintToBits } from "./util.js";
import { msm } from "./bigint/msm.js";
import { msmBasic } from "./msm-basic.js";
import { createScalar } from "./scalar-simple.js";
import { assertDeepEqual } from "./testing/nested.js";

const Field = await createMsmField({ p: curveParams.modulus, w: 29, beta: 1n });
const Scalar = await createScalar({ q: curveParams.order, w: 29 });

const Curve = createCurveProjective(Field, curveParams);
const CurveBigint = Curve.Bigint;

// create random generators for points

const scalar = spec<bigint, boolean[]>(Random.field(CurveBigint.order), {
  there: bigintToBits,
  back: () => throwError("TODO"),
});

const msmScalar: WasmSpec<bigint> = wasmSpec(
  Scalar,
  Random.field(curveParams.order),
  {
    size: Scalar.sizeField,
    there: Scalar.writeBigint,
    back: Scalar.toBigint,
  }
);

const pointStrict = wasmSpec(
  Field,
  Random(() => CurveBigint.random(true)),
  {
    size: Curve.size,
    there: Curve.fromBigint,
    back: Curve.toBigint,
  }
);
const point: WasmSpec<BigintPoint> = {
  ...pointStrict,
  assertEqual(wasm, bigint, message) {
    if (!CurveBigint.isEqual(wasm, bigint)) {
      console.log("wasm  ", wasm);
      console.log("bigint", bigint);
      throw new Error(message);
    }
  },
};
const pointAffine: WasmSpec<BigintPoint> = {
  ...point,
  rng: Random(() => CurveBigint.random(false)),
};

const field = Random.uniformField(CurveBigint.modulus);
const notAPoint = wasmSpec(
  Field,
  Random.record({ X: field, Y: field, Z: field }),
  { size: Curve.size, there: Curve.fromBigint, back: Curve.toBigint }
);

// test msm

// const n = 0; // works
const n = 4;
let N = 1 << n;

let inputs = Spec.record({
  scalars: Spec.array(msmScalar, N),
  points: Spec.array(pointAffine, N),
});

for (let bigintInputs of sample(inputs.rng, 100)) {
  let bigintResult = msm(
    CurveBigint,
    bigintInputs.scalars,
    bigintInputs.points
  );

  let wasmInputs = inputs.there(bigintInputs);
  let scalarPtr = wasmInputs.scalars[0];
  let pointPtr = wasmInputs.points[0];
  let { result } = await msmBasic(
    { Curve, Scalar, Field },
    scalarPtr,
    pointPtr,
    N
  );
  let actualResult = point.back(result);
  assertDeepEqual(actualResult, bigintResult);
}

// TODO enable async

// equiv(
//   { from: [inputs], to: point, scratch: 50 },
//   ({ scalars, points }) => msm(CurveBigint, scalars, points),
//   (scratch, out, { scalars, points }) => {
//     let result = await msmBasic(
//       { Curve, Scalar, Field },
//       scalars[0],
//       points[0],
//       N
//     );
//   },
//   "msm"
// );

// test equivalence of curve implementations

const equiv = createEquivalentWasm(Field, { logSuccess: true });

// bigint roundtrip

equiv(
  { from: [point], to: pointStrict },
  (P) => P,
  Curve.copy,
  "bigint roundtrip"
);

// addition

equiv(
  { from: [point, point], to: pointStrict, scratch: 11 },
  CurveBigint.add,
  Curve.add,
  "add"
);

// mixed addition

equiv(
  { from: [point, pointAffine], to: pointStrict, scratch: 11 },
  CurveBigint.add,
  Curve.addMixed,
  "add mixed"
);

// adding zero

equiv(
  { from: [point], to: pointStrict, scratch: 11 },
  (P) => CurveBigint.add(P, CurveBigint.zero),
  (scratch, out, P) => Curve.add(scratch, out, P, Curve.zero),
  "add zero"
);

// subtraction

equiv(
  { from: [point, point], to: pointStrict, scratch: 11 },
  (p, q) => CurveBigint.add(p, CurveBigint.negate(q)),
  Curve.sub,
  "sub"
);

// mixed subtraction

equiv(
  { from: [point, pointAffine], to: pointStrict, scratch: 11 },
  (p, q) => CurveBigint.add(p, CurveBigint.negate(q)),
  Curve.subMixed,
  "sub mixed"
);

// doubling

equiv(
  { from: [point], to: pointStrict, scratch: 8 },
  CurveBigint.double,
  Curve.double,
  "double"
);

// negation

equiv(
  { from: [point], to: pointStrict },
  CurveBigint.negate,
  Curve.negate,
  "negate"
);

// adding the negation

equiv(
  { from: [point], to: pointStrict, scratch: 11 },
  (P) => CurveBigint.add(P, CurveBigint.negate(P)),
  (scratch, out, P) => {
    Curve.negate(out, P);
    Curve.add(scratch, out, out, P);
  },
  "add negation"
);

// scalar multiplication

equiv(
  { from: [scalar, point], to: point, scratch: 15 },
  CurveBigint.scale,
  Curve.scale,
  "scale"
);

// is zero

equiv(
  { from: [point], to: Spec.boolean },
  CurveBigint.isZero,
  Curve.isZero,
  "is zero"
);

const zero = WasmSpec.constant(point, CurveBigint.zero);

equiv(
  { from: [zero], to: Spec.boolean },
  CurveBigint.isZero,
  Curve.isZero,
  "is zero"
);

// is on curve

equiv(
  { from: [point], to: Spec.boolean, scratch: 3 },
  CurveBigint.isOnCurve,
  Curve.isOnCurve,
  "is on curve"
);

equiv(
  { from: [notAPoint], to: Spec.boolean, scratch: 3 },
  CurveBigint.isOnCurve,
  Curve.isOnCurve,
  "is on curve (on invalid point)"
);

// is in subgroup

equiv(
  { from: [point], to: Spec.boolean, scratch: 19 },
  () => true,
  Curve.isInSubgroup,
  "is in subgroup"
);
