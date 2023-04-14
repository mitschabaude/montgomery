import { Module, memory } from "wasmati";
import { barrettReduction } from "./barrett.js";
import { glv } from "./glv.js";
import { multiplySchoolbook } from "./multiply-schoolbook.js";

let p =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
let q = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

// lambda**3 = 1 (mod q), beta**3 = 1 (mod p)
// (beta*x, y) = lambda * (x, y)
// (beta*x, -y) = (-lambda) * (x, y)
// where lambda = -z^2
// where z = 0xd201000000010000
let minusZ = 0xd201000000010000n;
let minusLambda1 = minusZ ** 2n;
let lambda1 = q - minusLambda1;
let beta1 =
  0x5f19672fdf76ce51ba69c6076a0f77eaddb3a93be6f89688de17d813620a00022e01fffffffefffen;
// a different solution is lambda2 = z^2 - 1
// might be better because we can use it directly instead of its negative
let lambda2 = minusZ ** 2n - 1n;
let beta2 =
  0x1a0111ea397fe699ec02408663d4de85aa0d857d89759ad4897d29650fb85f9b409427eb4f49fffd8bfd00000000aaacn;

const lambda = lambda2;
const w = 29;
const wn = BigInt(w);
const wordMax = (1n << wn) - 1n;

const { multiply } = multiplySchoolbook(lambda, w);
const { barrett } = barrettReduction(lambda, w, multiply);

let { decompose } = glv(q, lambda, w, barrett);

let mem = memory({ min: 1 << 10 });
let module = Module({ exports: { decompose, mem } });

let { instance } = await module.instantiate();
let { decompose: decompose_ } = instance.exports;
export { decompose_ as decompose };
