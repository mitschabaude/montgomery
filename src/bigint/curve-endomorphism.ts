import { assert } from "../util.js";
import { BigintField } from "./field.js";

export { computeEndoConstants };

/**
 * Compute constants for curve endomorphism (cube roots of unity in base and scalar field)
 *
 * Throws if conditions for a cube root-based endomorphism are not met.
 */
function computeEndoConstants(
  Field: BigintField,
  Scalar: BigintField,
  G: { x: bigint; y: bigint },
  scaleAffine: (
    s: bigint,
    G: { x: bigint; y: bigint }
  ) => { x: bigint; y: bigint }
) {
  let p = Field.modulus;
  let q = Scalar.modulus;
  // if there is a cube root of unity, it generates a subgroup of order 3
  assert(p % 3n === 1n, "Base field has a cube root of unity");
  // assert(q % 3n === 1n, "Scalar field has a cube root of unity");

  // find a cube root of unity in Fq (endo scalar)
  // we need lambda^3 = 1 and lambda != 1, which implies the quadratic equation
  // lambda^2 + lambda + 1 = 0
  // solving for lambda, we get lambda = (-1 +- sqrt(-3)) / 2
  let sqrtMinus3 = Scalar.sqrt(Scalar.negate(3n));
  assert(sqrtMinus3 !== undefined, "Scalar field has a square root of -3");
  let lambda = Scalar.multiply(
    Scalar.subtract(sqrtMinus3, 1n),
    Scalar.inverse(2n)
  );
  assert(lambda !== undefined, "Scalar field has a cube root of unity");

  // sanity check
  assert(Scalar.exp(lambda, 3n) === 1n, "lambda is a cube root");
  assert(lambda !== 1n, "lambda is not 1");

  // compute beta such that lambda * (x, y) = (beta * x, y) (endo base)
  let lambdaG = scaleAffine(lambda, G);
  assert(lambdaG.y === G.y, "multiplication by lambda is a cheap endomorphism");

  let beta = Field.multiply(lambdaG.x, Field.inverse(G.x));
  assert(Field.exp(beta, 3n) === 1n, "beta is a cube root");
  assert(beta !== 1n, "beta is not 1");

  return { lambda, beta };
}
