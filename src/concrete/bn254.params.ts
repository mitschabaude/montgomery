import type { CurveParams } from "../bigint/affine-weierstrass.ts";

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

// GLV endomorphism: β is a primitive cube root of 1 in Fp, λ a primitive cube
// root of 1 in Fq, with λ·G = (β·Gx, Gy)
const beta =
  0x30644e72e131a0295e6dd9e7e0acccb0c28f069fbb966e3de4bd44e5607cfd48n;
const lambda =
  0x30644e72e131a029048b6e193fd84104cc37a73fec2bc5e9b8ca0b2d36636f23n;

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
