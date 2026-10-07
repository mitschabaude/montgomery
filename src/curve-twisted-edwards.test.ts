import { type BigintPoint } from "./bigint/twisted-edwards.ts";
import { curveParams, p } from "./concrete/ed-on-bls12-377.params.ts";
import { createRandomPointsFastSingleCurve } from "./curve-random.ts";
import { createCurveTwistedEdwards } from "./curve-twisted-edwards.ts";
import { tic, toc } from "./testing/tictoc.ts";
import { createMsmField } from "./field-msm.ts";
import { resolveFieldBackend } from "./field-backend.ts";
import {
  WasmSpec,
  createEquivalentWasm,
  wasmSpec,
} from "./testing/equivalent-wasm.ts";
import { Spec, spec, throwError } from "./testing/equivalent.ts";
import { Random } from "./testing/random.ts";
import { assert, bigintToBits } from "./util.ts";

// The wide backend runs where Wasm wide arithmetic is enabled (npm run test-wide).
const Field = await createMsmField({
  p,
  beta: 1n,
  backend: resolveFieldBackend("auto"),
});

const Curve = createCurveTwistedEdwards(Field, curveParams);
const CurveBigint = Curve.Bigint;

// create random generators for points

const scalar = spec<bigint, boolean[]>(Random.field(CurveBigint.order), {
  there: bigintToBits,
  back: () => throwError("TODO"),
});
const pointStrict = wasmSpec(Field, Random(CurveBigint.random), {
  size: Curve.size,
  there: Curve.fromBigint,
  back: Curve.toBigint,
});
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
const field = Random.uniformField(CurveBigint.modulus);
const notAPoint = wasmSpec(
  Field,
  Random.record({ X: field, Y: field, Z: field, T: field }),
  { size: Curve.size, there: Curve.fromBigint, back: Curve.toBigint }
);

const equiv = createEquivalentWasm(Field, { logSuccess: true });

// test equivalence of curve implementations

// bigint roundtrip

equiv(
  { from: [point], to: pointStrict },
  (P) => P,
  Curve.copy,
  "bigint roundtrip"
);

// addition

equiv(
  { from: [point, point], to: point, scratch: 9 },
  CurveBigint.add,
  Curve.add,
  "add"
);

// equal points take the fallback of the dedicated addition formulas
equiv(
  { from: [point], to: point, scratch: 9 },
  (P) => CurveBigint.add(P, P),
  (scratch, out, P) => Curve.add(scratch, out, P, P),
  "add equal points"
);

// mixed addition and subtraction, with Z2 = 1
const pointAffine = wasmSpec(
  Field,
  Random.map(Random(CurveBigint.random), (P) =>
    CurveBigint.fromAffine(CurveBigint.toAffine(P))
  ),
  { size: Curve.size, there: Curve.fromBigint, back: Curve.toBigint }
);
equiv(
  { from: [point, pointAffine], to: point, scratch: 9 },
  CurveBigint.add,
  Curve.addMixed,
  "add mixed"
);
equiv(
  { from: [point, pointAffine], to: point, scratch: 9 },
  (P, Q) => CurveBigint.add(P, CurveBigint.negate(Q)),
  Curve.subMixed,
  "subtract mixed"
);
equiv(
  { from: [pointAffine], to: point, scratch: 9 },
  (P) => CurveBigint.add(P, P),
  (scratch, out, P) => Curve.addMixed(scratch, out, P, P),
  "add mixed equal points"
);

// adding zero

equiv(
  { from: [point], to: point, scratch: 9 },
  (P) => CurveBigint.add(P, CurveBigint.zero),
  (scratch, out, P) => Curve.add(scratch, out, P, Curve.zero),
  "add zero"
);

// doubling

equiv(
  { from: [point], to: pointStrict, scratch: 9 },
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
  { from: [point], to: point, scratch: 9 },
  (P) => CurveBigint.add(P, CurveBigint.negate(P)),
  (scratch, out, P) => {
    Curve.negate(out, P);
    Curve.add(scratch, out, out, P);
  },
  "add negation"
);

// scalar multiplication

equiv(
  { from: [scalar, point], to: point, scratch: 13 },
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
  { from: [point], to: Spec.boolean, scratch: 2 },
  CurveBigint.isOnCurve,
  Curve.isOnCurve,
  "is on curve"
);

equiv(
  { from: [notAPoint], to: Spec.boolean, scratch: 2 },
  CurveBigint.isOnCurve,
  Curve.isOnCurve,
  "is on curve (on invalid point)"
);

// is in subgroup

equiv(
  { from: [point], to: Spec.boolean, scratch: 17 },
  () => true,
  Curve.isInSubgroup,
  "is in subgroup"
);

// random points

let points = Field.global.getPointers(1 << 11, Curve.size);
let scratch = Field.global.getPointers(20);

tic("random points");
Curve.randomPoints(points);
toc();

tic("check points");
for (let point of points) {
  assert(Curve.isOnCurve(scratch, point), "point is on curve");
  assert(Curve.isInSubgroup(scratch, point), "point is in subgroup");
  assert(
    !!Field.isEqual(Curve.Z(point), Field.constants.mg1),
    "point is affine"
  );
}
toc();

// fast random points

let randomPointsFast = createRandomPointsFastSingleCurve({ Field, Curve });
tic("random points fast");
let points1 = await randomPointsFast(1 << 11);
toc();

tic("check points");
for (let point of points1) {
  assert(Curve.isOnCurve(scratch, point), "point is on curve");
  assert(Curve.isInSubgroup(scratch, point), "point is in subgroup");
  assert(
    !!Field.isEqual(Curve.Z(point), Field.constants.mg1),
    "point is affine"
  );
}
toc();
