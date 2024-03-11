import type { CurveParams } from "../bigint/affine-weierstrass.js";
import { bigintToBits } from "../util.js";

export { p, q, beta, lambda, curveParams, asBits };

const p =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
const q = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

// lambda**3 = 1 (mod q), beta**3 = 1 (mod p)
// (beta*x, y) = lambda * (x, y)
// (beta*x, -y) = (-lambda) * (x, y)

// one solution is lambda = -z^2
// where z = 0xd201000000010000
const minusZ = 0xd201000000010000n;
const minusLambda1 = minusZ ** 2n;
const lambda1 = q - minusLambda1;
const beta1 =
  0x5f19672fdf76ce51ba69c6076a0f77eaddb3a93be6f89688de17d813620a00022e01fffffffefffen;

// a different solution is lambda2 = z^2 - 1
// better because we can use it directly instead of its negative
const lambda2 = minusZ ** 2n - 1n;
const beta2 =
  0x1a0111ea397fe699ec02408663d4de85aa0d857d89759ad4897d29650fb85f9b409427eb4f49fffd8bfd00000000aaacn;

const lambda = lambda2;
const beta = beta2;

let asBits = {
  minusZ: bigintToBits(0xd201000000010000n, 64),
};

const cofactor = 0x396c8c005555e1568c00aaab0000aaabn;
const b = 4n;

const curveParams: CurveParams = {
  label: "bls12-381",
  modulus: p,
  order: q,
  cofactor,
  a: 0n,
  b,
  generator: {
    x: 0x17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bbn,
    y: 0x08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1n,
  },
  endomorphism: { beta, lambda },
};
