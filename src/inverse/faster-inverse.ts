import { Field, Random } from "../concrete/pasta.js";
import { mod, modInverse } from "../field-util.js";
import { assert } from "../util.js";

const { p } = Field;

let x = Random.randomField();
let z = modInverse(x, p);

assert(mod(z * x, p) === 1n);

let [r, k] = almostInverse(x, p);

let b = Field.bitLength;
assert(k + 1 >= b && k < 2 * b);
assert(r < p, "r < p");

let twoToK = mod(1n << BigInt(k), p);
let twoToMinusK = modInverse(twoToK, p);

assert(mod(x * r * twoToMinusK, p) === 1n, "almost inverse");

function almostInverse(a: bigint, p: bigint) {
  let u = p;
  let v = a;
  let r = 0n;
  let s = 1n;
  let k = 0;

  [v, r, k] = makeOdd(v, r, k);

  while (true) {
    if (u === v) break;

    if (u > v) {
      u -= v;
      r += s;
      [u, s, k] = makeOdd(u, s, k);
    } else {
      v -= u;
      s += r;
      [v, r, k] = makeOdd(v, r, k);
    }
  }
  return [s, k] as const;
}

function makeOdd(u: bigint, s: bigint, k: number) {
  while ((u & 1n) === 0n) {
    u >>= 1n;
    s <<= 1n;
    k++;
  }
  return [u, s, k] as const;
}
