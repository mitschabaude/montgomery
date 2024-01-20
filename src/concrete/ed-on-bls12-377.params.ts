import {
  createCurveTwistedEdwards,
  CurveParams,
} from "../bigint/twisted-edwards.js";

export { p, q, h, d, lambda, beta, nBits, nBytes, G };

const p = 0x12ab655e9a2ca55660b44d1e5c37b00159aa76fed00000010a11800000000001n;
const q =
  2111115437357092606062206234695386632838870926408408195193685246394721360383n;

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

const params: CurveParams = {
  modulus: p,
  order: q,
  cofactor: h,
  d,
  generator: G,
};

const lambda =
  0x12ab655e9a2ca55660b44d1e5c37b00114885f32400000000000000000000000n;
const beta =
  0x1ae3a4617c510eabc8756ba8f8c524eb8882a75cc9bc8e359064ee822fb5bffd1e945779fffffffffffffffffffffffn;

const debug = true;

if (debug) {
  let { beta, lambda } = createCurveTwistedEdwards(params);
  console.log("lambda", lambda);
  console.log("beta", beta);
}
