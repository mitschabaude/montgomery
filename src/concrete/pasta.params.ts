import type { CurveParams } from "../bigint/affine-weierstrass.js";
import { mod } from "../bigint/field-util.js";
import { exp } from "../bigint/field.js";

export { p, q, b, lambda, beta, nBits, nBytes, curveParams };

// base / scalar field moduli
// Fp is the base field of Pallas, scalar field of Vesta
// Fq is the scalar field of Pallas, base field of Vesta
const p = 0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001n;
const q = 0x40000000000000000000000000000000224698fc0994a8dd8c46eb2100000001n;

// curve equation is y^2 = x^3 + 5
const b = 5n;

const nBits = 255;
const nBytes = 32;

// compute cube root in Fq (endo scalar) as lambda =  5 ^ (q - 1)/3
const lambda = exp(5n, (q - 1n) / 3n, q);
const lambda2 = mod(lambda * lambda, q);

const curveParams: CurveParams = {
  modulus: p,
  order: q,
  cofactor: 1n,
  b,
  generator: {
    x: 1n,
    y: 0x1b74b5a30a12937c53dfa9f06378ee548f655bd4333d477119cf7a23caed2abbn,
  },
};

if (mod(lambda2 * lambda, q) !== 1n) throw Error("lambda is not cube root");

// corresponding cube root in Fp (endo base) is found by computing beta such that
// lambda * (1, y) = (beta, y)
// where (1, y) is the canonical generator of E(Fp)
// turns out that beta is lambda^2 in Fp and vice versa
const beta2 = exp(5n, (p - 1n) / 3n, p);
const beta = mod(beta2 * beta2, p);

if (mod(beta2 * beta, p) !== 1n) throw Error("beta is not cube root");
