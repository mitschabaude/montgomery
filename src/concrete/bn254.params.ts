import type { CurveParams } from "../bigint/affine-weierstrass.ts";
import { mod } from "../bigint/field-util.ts";
import { exp } from "../bigint/field.ts";
import { createCurveAffine } from "../bigint/affine-weierstrass.ts";

export { bn254Params };

// BN254 (aka alt_bn128), the pairing-friendly curve used by Ethereum's
// EIP-196/197 precompiles. Here we expose G1 only (we don't support G2 yet).
//
// base field
const p = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n;
// scalar field (order of G1)
const q = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;

const b = 3n;

// G1 generator
const generator = { x: 1n, y: 2n };

// GLV endomorphism. Compute primitive cube roots of 1 in Fp and Fq, then
// pick the consistent pair (β, λ) such that λ·G = (β·Gx, Gy).
function primitiveCubeRoot(m: bigint): bigint {
  for (let g = 2n; g < 1000n; g++) {
    const r = exp(g, (m - 1n) / 3n, m);
    if (r !== 1n) return r;
  }
  throw Error("no non-cube found");
}
const betaCandidate = primitiveCubeRoot(p);
if (mod(betaCandidate * betaCandidate * betaCandidate, p) !== 1n) {
  throw Error("bn254: beta candidate is not a cube root of 1 mod p");
}
const lambdaCandidate = primitiveCubeRoot(q);
if (mod(lambdaCandidate * lambdaCandidate * lambdaCandidate, q) !== 1n) {
  throw Error("bn254: lambda candidate is not a cube root of 1 mod q");
}

// pick the consistent pairing (β, λ) or (β², λ²) such that λ·G = (β·Gx, Gy)
const [beta, lambda] = pickConsistentPair();

const bn254Params: CurveParams = {
  label: "bn254",
  modulus: p,
  order: q,
  cofactor: 1n,
  a: 0n,
  b,
  generator,
  endomorphism: { beta, lambda },
};

function pickConsistentPair(): [bigint, bigint] {
  const tmpParams: CurveParams = {
    label: "bn254-tmp",
    modulus: p,
    order: q,
    cofactor: 1n,
    a: 0n,
    b,
    generator,
    // placeholder endomorphism — unused by createCurveAffine.scale below
    endomorphism: { beta: 1n, lambda: 1n },
  };
  const C = createCurveAffine(tmpParams);
  const betas = [betaCandidate, mod(betaCandidate * betaCandidate, p)];
  const lambdas = [lambdaCandidate, mod(lambdaCandidate * lambdaCandidate, q)];
  for (const b of betas) {
    for (const l of lambdas) {
      const lG = C.scale(l, C.one);
      if (lG.x === mod(b * generator.x, p) && lG.y === generator.y) {
        return [b, l];
      }
    }
  }
  throw Error("bn254: no consistent endomorphism pair found");
}
