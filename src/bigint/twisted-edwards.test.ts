import { Random, test } from "../testing/property.js";
import { createCurveTwistedEdwards } from "./twisted-edwards.js";
import { curveParams } from "../concrete/ed-on-bls12-377.params.js";
import { assert } from "../util.js";

let Curve = createCurveTwistedEdwards(curveParams);

let scalar = Random.field(Curve.order);
// let point = Random.map(scalar, (s) => Curve.scale(s, Curve.one));
let point = Random(Curve.random);

test(point, point, point, scalar, scalar, (P, Q, R, s, t) => {
  // random point is as expected
  assert(Curve.isOnCurve(P), "point is on curve");
  assert(Curve.isZero(Curve.scale(Curve.order, P)), "order * P = ∞");

  // random points are not equal, and not zero
  assert(!Curve.isEqual(P, Q), "random points are not equal");
  assert(!Curve.isZero(P), "random points are not zero");

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
    Curve.isEqual(Curve.add(P, Curve.add(Q, R)), Curve.add(Curve.add(P, Q), R)),
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

  // zero is the identity
  assert(Curve.isEqual(Curve.add(P, Curve.zero), P), "P + 0 = P");
  assert(Curve.isEqual(Curve.add(Curve.zero, P), P), "0 + P = P");

  // scaling maps to the curve
  assert(Curve.isOnCurve(Curve.scale(s, P)), "scaling maps to the curve");

  // scaling by two scalars is scaling by the product
  assert(
    Curve.isEqual(
      Curve.scale(s, Curve.scale(t, P)),
      Curve.scale(Curve.Scalar.mul(s, t), P)
    ),
    "scaling twice"
  );

  // the generator is on the curve
  assert(Curve.isOnCurve(Curve.one), "generator is on the curve");
});
