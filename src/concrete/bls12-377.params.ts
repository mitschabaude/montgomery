import { scale } from "../extra/dumb-curve-affine.js";
import { mod } from "../bigint/field-util.js";
import { exp, inverse } from "../bigint/field.js";
import { assert, bigintToBits } from "../util.js";
import type { CurveParams } from "../bigint/affine-weierstrass.js";

export { p, q, h, b, lambda, beta, nBits, nBytes, G, curveParams };

const p =
  0x01ae3a4617c510eac63b05c06ca1493b1a22d9f300f5138f1ef3622fba094800170b5d44300000008508c00000000001n;
const q = 0x12ab655e9a2ca55660b44d1e5c37b00159aa76fed00000010a11800000000001n;

// curve equation is y^2 = x^3 + 1
const b = 1n;

const nBits = 377;
const nBytes = 48;

// cofactor
const h = 0x170b5d44300000000000000000000000n;

// generator
const G = {
  x: 0x008848defe740a67c8fc6225bf87ff5485951e2caa9d41bb188282c8bd37cb5cd5481512ffcd394eeab9b16eb21be9efn,
  y: 0x01914a69c5102eff1f674f5d30afeec4bd7fb348ca3e52d96d182ad44fb82305c2fe3d3634a9591afd82de55559c8ea6n,
  isInfinity: false,
};

const curveParams: CurveParams = {
  label: "bls12-377",
  modulus: p,
  order: q,
  cofactor: h,
  a: 0n,
  b,
  generator: { x: G.x, y: G.y },
};

const lambda =
  0x12ab655e9a2ca55660b44d1e5c37b00114885f32400000000000000000000000n;
const beta =
  0x1ae3a4617c510eabc8756ba8f8c524eb8882a75cc9bc8e359064ee822fb5bffd1e945779fffffffffffffffffffffffn;

const debug = false;

if (debug) {
  // compute cube root in Fq (endo scalar) as lambda =  x^(q - 1)/3 for some small x
  const lambda_ = exp(11n, (q - 1n) / 3n, q);

  assert(lambda === lambda_, "lambda is correct");
  const lambda2 = mod(lambda * lambda, q);
  assert(mod(lambda * lambda2, q) === 1n, "lambda is a cube root");

  // compute beta such that lambda * (x, y) = (beta * x, y) (endo base)
  let lambdaBits = bigintToBits(lambda, 256);
  let lambdaG = scale(lambdaBits, G, p);
  assert(lambdaG.y === G.y, "multiplication by lambda is a cheap endomorphism");

  const beta_ = mod(lambdaG.x * inverse(G.x, p), p);
  assert(beta === beta_, "beta is correct");
  assert(exp(beta, 3n, p) === 1n, "beta is a cube root");

  // note: since both phi1: p -> lambda*p and phi2: p -> (beta*p.x, p.y) are homomorphisms (easy to check),
  // and they agree on a single point, they must agree on all points in the same subgroup:
  // (phi1 - phi2)(s*G) = s*(phi1 - pgi2)(G) = 0
}
