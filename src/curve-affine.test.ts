import {
  type BigintPoint,
  createCurveAffine as createBigintCurve,
} from "./bigint/affine-weierstrass.ts";
import { pallasParams as curveParams } from "./concrete/pasta.params.ts";
import { createCurveAffine } from "./curve-affine.ts";
import { createCurveProjective } from "./curve-projective.ts";
import { createMsmField } from "./field-msm.ts";
import { resolveFieldBackend } from "./field-backend.ts";
import {
  WasmSpec,
  createEquivalentWasm,
  wasmSpec,
} from "./testing/equivalent-wasm.ts";
import { Random } from "./testing/random.ts";

// The wide backend runs where Wasm wide arithmetic is enabled (npm run test-wide).
const Field = await createMsmField({
  p: curveParams.modulus,
  curve: "weierstraß",
  beta: curveParams.endomorphism!.beta,
  backend: resolveFieldBackend("auto"),
});
const Projective = createCurveProjective(Field, curveParams);
const Affine = createCurveAffine(Field, Projective, curveParams.b);
const CurveBigint = createBigintCurve(curveParams);

const point: WasmSpec<BigintPoint> = {
  ...wasmSpec(
    Field,
    Random(() => CurveBigint.random()),
    {
      size: Affine.size,
      there: Affine.writeBigint,
      back: Affine.toBigint,
    }
  ),
  // zero has more than one bigint representation
  assertEqual(wasm, bigint, message) {
    if (!CurveBigint.isEqual(wasm, bigint)) {
      console.log("wasm  ", wasm);
      console.log("bigint", bigint);
      throw new Error(message);
    }
  },
};
const zero: WasmSpec<BigintPoint> = WasmSpec.constant(point, CurveBigint.zero);

const equiv = createEquivalentWasm(Field, { logSuccess: true });

// addition

equiv({ from: [point, point], to: point }, CurveBigint.add, Affine.add, "add");

equiv(
  { from: [point, point], to: point },
  CurveBigint.add,
  (out, P, Q) => {
    Affine.add(P, P, Q);
    Affine.copy(out, P);
  },
  "add into first summand"
);

equiv(
  { from: [point, point], to: point },
  CurveBigint.add,
  (out, P, Q) => {
    Affine.add(Q, P, Q);
    Affine.copy(out, Q);
  },
  "add into second summand"
);

equiv(
  { from: [point, zero], to: point },
  CurveBigint.add,
  Affine.add,
  "add zero"
);

equiv(
  { from: [zero, point], to: point },
  CurveBigint.add,
  Affine.add,
  "add to zero"
);

equiv(
  { from: [point], to: point },
  CurveBigint.double,
  (out, P) => Affine.add(out, P, P),
  "add to itself"
);

// negation

equiv(
  { from: [point], to: point },
  CurveBigint.negate,
  Affine.negate,
  "negate"
);

equiv(
  { from: [point], to: point },
  CurveBigint.negate,
  (out, P) => {
    Affine.negate(P, P);
    Affine.copy(out, P);
  },
  "negate in place"
);

equiv(
  { from: [zero], to: point },
  CurveBigint.negate,
  Affine.negate,
  "negate zero"
);

equiv(
  { from: [point], to: point },
  (P) => CurveBigint.add(P, CurveBigint.negate(P)),
  (out, P) => {
    Affine.negate(out, P);
    Affine.add(out, out, P);
  },
  "add negation"
);
