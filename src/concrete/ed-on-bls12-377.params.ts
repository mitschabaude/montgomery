import { CurveParams } from "../bigint/twisted-edwards.js";

export { p, q, h, d, nBits, nBytes, G, curveParams };

const p = 0x12ab655e9a2ca55660b44d1e5c37b00159aa76fed00000010a11800000000001n;
const q = 0x4aad957a68b2955982d1347970dec005293a3afc43c8afeb95aee9ac33fd9ffn;

// curve equation is -x^2 + y^2 = 1 + d x^2 y^2
const d = 3021n;

const nBits = 253;
const nBytes = 32;

// cofactor
const h = 4n;

// generator
const G = {
  x: 0x9f1b5a5baf6acf06fed91c9ae9ebfa06068dd2835790980894e2328f3ebca05n,
  y: 0x9a20df36571ac3cd906b256080ba8454453c177aaf3131bb50a67bf1a806781n,
  isInfinity: false,
};

const curveParams: CurveParams = {
  label: "ed-on-bls12-377",
  modulus: p,
  order: q,
  cofactor: h,
  d,
  generator: G,
};
