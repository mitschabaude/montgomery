import type { CurveParams } from "../bigint/affine-weierstrass.ts";

export { p, q, b, lambda, beta, nBits, nBytes, pallasParams, vestaParams };

// base / scalar field moduli
// Fp is the base field of Pallas, scalar field of Vesta
// Fq is the scalar field of Pallas, base field of Vesta
const p = 0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001n;
const q = 0x40000000000000000000000000000000224698fc0994a8dd8c46eb2100000001n;

// curve equation is y^2 = x^3 + 5
const b = 5n;

const nBits = 255;
const nBytes = 32;

// GLV endomorphism: beta is a primitive cube root of 1 in Fp, lambda a
// primitive cube root of 1 in Fq, with lambda * (x, y) = (beta * x, y)
const lambda =
  0x6819a58283e528e511db4d81cf70f5a0fed467d47c033af2aa9d2e050aa0e4fn;
const beta =
  0x12ccca834acdba712caad5dc57aab1b01d1f8bd237ad31491dad5ebdfdfe4ab9n;

const pallasParams: CurveParams = {
  label: "pallas",
  modulus: p,
  order: q,
  cofactor: 1n,
  a: 0n,
  b,
  generator: {
    x: 1n,
    y: 0x1b74b5a30a12937c53dfa9f06378ee548f655bd4333d477119cf7a23caed2abbn,
  },
  endomorphism: { beta, lambda },
};

// Vesta is Pallas' sister: same curve equation y^2 = x^3 + 5, base/scalar
// fields swapped.
const lambdaV =
  0x2d33357cb532458ed3552a23a8554e5005270d29d19fc7d27b7fd22f0201b547n;
const betaV =
  0x397e65a7d7c1ad71aee24b27e308f0a61259527ec1d4752e619d1840af55f1b1n;

// Vesta generator: (1, y) with y = sqrt(6) mod q
const vestaGeneratorY =
  0x1943666ea922ae6b13b64e3aae89754cacce3a7f298ba20c4e4389b9b0276a62n;

const vestaParams: CurveParams = {
  label: "vesta",
  modulus: q,
  order: p,
  cofactor: 1n,
  a: 0n,
  b,
  generator: { x: 1n, y: vestaGeneratorY },
  endomorphism: { beta: betaV, lambda: lambdaV },
};
