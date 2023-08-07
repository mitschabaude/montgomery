import { Field, Random } from "../concrete/pasta.js";
import { mod, modInverse } from "../field-util.js";
import { assert } from "../util.js";

const { p } = Field;

const w = 29n;

let x = Random.randomField();
// let x =
//   21055668057744206722049915034365825947141946607484548719881883519400681427846n;
let z = modInverse(x, p);

assert(mod(z * x, p) === 1n);

let [r, k] = almostInverse(x, p);

let b = Field.bitLength;
assert(k + 1n >= b && k < 2 * b);
assert(r < p, "r < p");

assert(mod(x * r - (1n << k), p) === 0n, "almost inverse");

function almostInverse(a: bigint, p: bigint) {
  let u = -p;
  let v = a;
  let r = 0n;
  let s = 1n;
  let k = 0n;

  while (true) {
    if ((u & (1n << k)) === 0n) {
      console.log("reduce u");
      v <<= 1n;
      s <<= 1n;
    } else if ((v & (1n << k)) === 0n) {
      console.log("reduce v");
      u <<= 1n;
      r <<= 1n;
    } else {
      let m = u + v;
      console.log({ u, v, m, k });
      if (m === 0n) break;
      if (m < 0n) {
        u = m;
        r = r + s;
        v <<= 1n;
        s <<= 1n;
      } else {
        v = m;
        s = r + s;
        u <<= 1n;
        r <<= 1n;
      }
    }
    k++;
    assert(v * r - u * s === 2n ** k * p);
    assert(mod(a * r - u, p) === 0n);
    assert(mod(a * s - v, p) === 0n);
  }
  return [s, k];
}

function makeOdd(u: bigint, s: bigint, k: bigint) {
  while ((u & 1n) === 0n) {
    u >>= 1n;
    s <<= 1n;
    k++;
  }
  return [u, s, k];
}
