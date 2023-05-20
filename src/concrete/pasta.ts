import { randomGenerators, mod, modExp } from "../field-util.js";

export {
  p,
  q,
  lambda,
  beta,
  nBits,
  nBytes,
  randomField,
  randomFieldx2,
  randomScalar,
};

const p = 0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001n;
const q = 0x40000000000000000000000000000000224698fc0994a8dd8c46eb2100000001n;

const nBits = 255;
const nBytes = 32;

const { randomField, randomFieldx2 } = randomGenerators(p);
const { randomField: randomScalar } = randomGenerators(q);

// compute cube root in Fq (endo scalar) as lambda =  5 ^ (q - 1)/3
const lambda = modExp(5n, (q - 1n) / 3n, { p: q });
const lambda2 = mod(lambda * lambda, q);

if (mod(lambda2 * lambda, q) !== 1n) throw Error("lambda is not cube root");

// corresponding cube root in Fp (endo base) is found by computing beta such that
// lambda * (1, y) = (beta, y)
// where (1, y) is the canonical generator of E(Fp)
// turns out that beta is lambda^2 in Fp and vice versa
const beta2 = modExp(5n, (p - 1n) / 3n, { p });
const beta = mod(beta2 * beta2, p);

if (mod(beta2 * beta, p) !== 1n) throw Error("beta is not cube root");
