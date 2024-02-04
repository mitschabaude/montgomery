import { Random, test } from "../testing/property.js";
import {
  createCurveTwistedEdwards,
  BigintPoint as TwistedEdwardsExtendedPoint,
} from "./twisted-edwards.js";
import { createCurveAffine, CurveParams } from "./affine-weierstrass.js";
import { createCurveProjective } from "./projective-weierstrass.js";
import { curveParams as pallasParams } from "../concrete/pasta.params.js";
import { curveParams as bls12381Params } from "../concrete/bls12-381.params.js";
import { curveParams as edOnBls12377Params } from "../concrete/ed-on-bls12-377.params.js";
import { assert } from "../util.js";
import { msm } from "./msm.js";

testValid(createCurveProjective(pallasParams));
testValid(createCurveTwistedEdwards(edOnBls12377Params));
testValid(createCurveProjective(bls12381Params));

testConsistent(pallasParams);
testConsistent(bls12381Params);

function testValid<Point>(Curve: InputCurve<Point>) {
  let point = Random(Curve.random);
  let scalar = Random.field(Curve.order);

  for (let n of [0, 1, 2, 4]) {
    let size = 1 << n;

    let inputs = Random.record({
      scalars: Random.array(scalar, size),
      points: Random.array(point, size),
    });

    test.verbose(
      `msm 2^${n} / valid / ${Curve.label}`,
      inputs,
      scalar,
      point,
      ({ scalars, points }, s, P) => {
        let scalarSum = scalars.reduce(Curve.Scalar.add);
        let pointSum = points.reduce(Curve.add);

        // taking the same point is multiplication by the sum of the scalars
        let expected = Curve.scale(scalarSum, P);
        let actual = msm(Curve, scalars, Array(size).fill(P));

        assert(Curve.isEqual(expected, actual), "same point");

        expected = Curve.zero;
        actual = msm(
          Curve,
          [...scalars, Curve.Scalar.negate(scalarSum)],
          Array(size + 1).fill(P)
        );
        assert(Curve.isEqual(expected, actual), "zero with same point");

        // taking the same scalar is multiplication by the sum of the points
        expected = Curve.scale(s, pointSum);
        actual = msm(Curve, Array(size).fill(s), points);
        assert(Curve.isEqual(expected, actual), "same scalar");
      }
    );
  }
}

function testConsistent(params: CurveParams) {
  let CurveAffine = createCurveAffine(params);
  let CurveProjective = createCurveProjective(params);

  let affine = Random(CurveAffine.random);
  let scalar = Random.field(params.order);

  for (let n of [1, 2]) {
    let size = 1 << n;

    let inputs = Random.record({
      scalars: Random.array(scalar, size),
      points: Random.array(affine, size),
    });

    test.verbose(
      `msm 2^${n} / affine = projective / ${params.label}`,
      inputs,
      ({ scalars, points }) => {
        let affineResult = msm(CurveAffine, scalars, points);

        assert(
          CurveAffine.isOnCurve(affineResult),
          "affine result is on curve"
        );

        let projectivePoints = points.map(CurveProjective.fromAffine);
        let projectiveResult = msm(CurveProjective, scalars, projectivePoints);

        assert(
          CurveAffine.isEqual(
            affineResult,
            CurveProjective.toAffine(projectiveResult)
          ),
          "affine and projective are consistent"
        );
      }
    );
  }
}

type InputCurve<Point> = {
  label: string;
  order: bigint;

  zero: Point;
  add: (P: Point, Q: Point) => Point;
  double: (P: Point) => Point;
  scale: (s: bigint, P: Point) => Point;
  isEqual: (P: Point, Q: Point) => boolean;

  random: () => Point;
  isOnCurve: (P: Point) => boolean;
  Scalar: {
    sizeInBits: number;
    add: (a: bigint, b: bigint) => bigint;
    negate: (a: bigint) => bigint;
  };
};
