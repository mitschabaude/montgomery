import { Random, test } from "../testing/property.js";
import {
  createCurveTwistedEdwards,
  BigintPoint as TwistedEdwardsExtendedPoint,
} from "./twisted-edwards.js";
import {
  createCurveAffine,
  BigintPoint as AffinePoint,
} from "./affine-weierstrass.js";
import {
  createCurveProjective,
  BigintPoint as ProjectivePoint,
} from "./projective-weierstrass.js";
import { curveParams as edBls12377Params } from "../concrete/ed-on-bls12-377.params.js";
import { pallasParams } from "../concrete/pasta.params.js";
import { curveParams as bls12381Params } from "../concrete/bls12-381.params.js";
import { curveParams as bls12377Params } from "../concrete/bls12-377.params.js";
import { assert } from "../util.js";

let testInputs: TestInput<any>[] = [
  // twisted edwards curve
  {
    label: "ed-on-bls12-377",
    Curve: createCurveTwistedEdwards(edBls12377Params),
    randomShape: twistedEdwardsShape,
  } satisfies TestInput<TwistedEdwardsExtendedPoint>,

  // projective weierstrass curves
  {
    label: "pallas",
    Curve: createCurveProjective(pallasParams),
    randomShape: projectiveShape,
  } satisfies TestInput<ProjectivePoint>,
  {
    label: "bls12-381",
    Curve: createCurveProjective(bls12381Params),
    randomShape: projectiveShape,
  } satisfies TestInput<ProjectivePoint>,
  {
    label: "bls12-377",
    Curve: createCurveProjective(bls12377Params),
    randomShape: projectiveShape,
  } satisfies TestInput<ProjectivePoint>,

  // affine weierstrass curves (just one test because this is very slow)
  {
    label: "bls12-381 (affine)",
    Curve: createCurveAffine(bls12381Params),
    randomShape: affineShape,
  } satisfies TestInput<AffinePoint>,
];

for (let input of testInputs) testCurve(input);

type TestInput<Point> = {
  label: string;
  Curve: InputCurve<Point>;
  randomShape: (field: Random<bigint>) => Random<Point>;
};

function testCurve<Point>({ label, Curve, randomShape }: TestInput<Point>) {
  let scalar = Random.field(Curve.order);
  let point = Random(Curve.random);

  const uniformField = Random.uniformField(Curve.modulus);
  const notAPoint = randomShape(uniformField);

  test.verbose(
    label,
    point,
    point,
    point,
    notAPoint,
    scalar,
    scalar,
    (P, Q, R, noP, s, t) => {
      // random point is as expected
      assert(Curve.isOnCurve(P), "point is on curve");
      assert(Curve.isInSubgroup(P), "order * P = ∞");

      // random points are not equal, and not zero
      assert(!Curve.isEqual(P, Q), "random points are not equal");
      assert(!Curve.isZero(P), "random points are not zero");

      // isOnCurve detects points not on the curve
      assert(!Curve.isOnCurve(noP), "isOnCurve");

      // a point equals itself, and zero equals zero
      assert(Curve.isEqual(P, P), "P = P");
      assert(Curve.isZero(Curve.zero), "zero is zero");

      // addition maps to the curve
      assert(Curve.isOnCurve(Curve.add(P, Q)), "addition maps to the curve");

      // negation maps to the curve
      assert(Curve.isOnCurve(Curve.negate(P)), "negation maps to the curve");

      // addition is commutative
      assert(
        Curve.isEqual(Curve.add(P, Q), Curve.add(Q, P)),
        "addition is commutative"
      );

      // addition is associative
      assert(
        Curve.isEqual(
          Curve.add(P, Curve.add(Q, R)),
          Curve.add(Curve.add(P, Q), R)
        ),
        "addition is associative"
      );

      // addition is distributive
      assert(
        Curve.isEqual(
          Curve.scale(s, Curve.add(P, Q)),
          Curve.add(Curve.scale(s, P), Curve.scale(s, Q))
        ),
        "addition is distributive"
      );

      // doubling is scaling by 2
      assert(
        Curve.isEqual(Curve.double(P), Curve.scale(2n, P)),
        "double = scale 2"
      );

      // adding the negation is zero
      assert(
        Curve.isEqual(Curve.add(P, Curve.negate(P)), Curve.zero),
        "P + -P = 0"
      );

      // negating twice is the identity
      assert(Curve.isEqual(Curve.negate(Curve.negate(P)), P), "-(-P) = P");

      // scaling by order-1 is negation
      assert(
        Curve.isEqual(Curve.scale(Curve.order - 1n, P), Curve.negate(P)),
        "scaling by order-1 is negation"
      );

      // zero is the identity
      assert(Curve.isEqual(Curve.add(P, Curve.zero), P), "P + 0 = P");
      assert(Curve.isEqual(Curve.add(Curve.zero, P), P), "0 + P = P");

      // scaling maps to the curve
      assert(Curve.isOnCurve(Curve.scale(s, P)), "scaling maps to the curve");

      // scaling by a non-zero scalar yields a non-zero point
      assert(
        s === 0n || !Curve.isZero(Curve.scale(s, P)),
        "scaling is injective"
      );

      // scaling by two scalars is scaling by the product
      assert(
        Curve.isEqual(
          Curve.scale(s, Curve.scale(t, P)),
          Curve.scale(Curve.Scalar.multiply(s, t), P)
        ),
        "scaling twice"
      );

      // the generator is on the curve
      assert(Curve.isOnCurve(Curve.one), "generator is on the curve");
    }
  );
}

type InputCurve<Point> = {
  modulus: bigint;
  order: bigint;

  zero: Point;
  one: Point;
  random: () => Point;
  add: (P: Point, Q: Point) => Point;
  negate: (P: Point) => Point;
  double: (P: Point) => Point;
  scale: (s: bigint, P: Point) => Point;
  isEqual: (P: Point, Q: Point) => boolean;
  isZero: (P: Point) => boolean;
  isOnCurve: (P: Point) => boolean;
  isInSubgroup: (P: Point) => boolean;

  Scalar: {
    multiply: (s: bigint, t: bigint) => bigint;
  };
};

function affineShape(f: Random<bigint>) {
  return Random.record({ x: f, y: f, isZero: Random.constant(false) });
}
function projectiveShape(f: Random<bigint>) {
  return Random.record({ X: f, Y: f, Z: f });
}
function twistedEdwardsShape(f: Random<bigint>) {
  return Random.record({ X: f, Y: f, Z: f, T: f });
}
