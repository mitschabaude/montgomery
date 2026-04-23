import type { CurveParams } from "../bigint/affine-weierstrass.ts";
import { mod } from "../bigint/field-util.ts";
import { createCurveAffine } from "../bigint/affine-weierstrass.ts";

export { secp256k1Params };

// p = 2^256 - 2^32 - 977
const p = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
// order n
const q = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const b = 7n;

const generator = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};

// GLV endomorphism (well-known values, see e.g. libsecp256k1)
// β is a primitive cube root of 1 in Fp, λ a primitive cube root of 1 in Fq
const beta = 0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501een;
const lambda = 0x5363ad4cc05c30e0a5261c028812645a122e22ea20816678df02967c1b23bd72n;

// sanity checks: cube roots of unity, and λ·G = (β·x, y)
if (mod(beta * beta * beta, p) !== 1n) {
  throw Error("secp256k1: beta is not a cube root of 1 mod p");
}
if (mod(lambda * lambda * lambda, q) !== 1n) {
  throw Error("secp256k1: lambda is not a cube root of 1 mod q");
}

const secp256k1Params: CurveParams = {
  label: "secp256k1",
  modulus: p,
  order: q,
  cofactor: 1n,
  a: 0n,
  b,
  generator,
  endomorphism: { beta, lambda },
};

// verify λ·G = (β·Gx, Gy) using bigint curve
{
  const C = createCurveAffine(secp256k1Params);
  const lambdaG = C.scale(lambda, C.one);
  const expectedX = mod(beta * generator.x, p);
  if (lambdaG.x !== expectedX || lambdaG.y !== generator.y) {
    throw Error("secp256k1: endomorphism (β, λ) pair is inconsistent");
  }
}
