import { test } from "node:test";
import assert from "node:assert/strict";
import { CurveParams, Weierstraß } from "../index.ts";
import {
  computeEndomorphism,
  createCurveAffine,
} from "../bigint/affine-weierstrass.ts";
import { exp } from "../bigint/field.ts";
import { mod } from "../bigint/field-util.ts";

// the predefined curves hard-code their generators and endomorphisms
for (let params of Object.values(CurveParams)) {
  test(`${params.label}: generator and endomorphism`, () => {
    let { modulus: p, order: q, b, generator: G } = params;
    assert.equal(mod(G.y * G.y - G.x ** 3n - b, p), 0n, "G is on the curve");

    let { beta, lambda } = params.endomorphism!;
    assert(beta !== 1n && exp(beta, 3n, p) === 1n, "beta is a cube root of 1");
    assert(lambda !== 1n && exp(lambda, 3n, q) === 1n, "lambda too");
    let lambdaG = createCurveAffine(params).scale(lambda, {
      ...G,
      isZero: false,
    });
    assert.deepEqual(lambdaG, { x: mod(beta * G.x, p), y: G.y, isZero: false });

    // the computed endomorphism is the same, or the other pair of cube roots
    let computed = computeEndomorphism(params);
    let other = { beta: mod(beta * beta, p), lambda: mod(lambda * lambda, q) };
    assert(
      [params.endomorphism, other].some(
        (e) => e!.beta === computed.beta && e!.lambda === computed.lambda
      ),
      "computed endomorphism matches"
    );
  });
}

test("curve without a given endomorphism", async () => {
  let { endomorphism, ...params } = CurveParams.pallas;
  let Curve = await Weierstraß.create(params);
  assert.deepEqual(Curve.params.endomorphism, computeEndomorphism(params));

  let N = 1 << 6;
  let pointPtrs = await Curve.Parallel.randomPointsFast(N);
  let scalarPtrs = await Curve.Parallel.randomScalars(N);
  let { result } = await Curve.Parallel.msm(scalarPtrs[0], pointPtrs[0], N);

  let { Field, Scalar, Affine, Projective, Bigint } = Curve;
  let scratch = Field.local.getPointers(5);
  let resultAffine = Field.getPointer(Affine.size);
  Projective.toAffine(scratch, resultAffine, result);
  let scalars = scalarPtrs.map((s) => Scalar.readBigint(s));
  let points = pointPtrs.map((g) =>
    Bigint.Projective.fromAffine(Affine.toBigint(g))
  );
  let expected = Bigint.Projective.toAffine(
    Bigint.Projective.msm(scalars, points)
  );
  assert.deepEqual(Affine.toBigint(resultAffine), expected);
});
