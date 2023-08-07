import { Field, Random } from "../concrete/pasta.js";
import { mod, modInverse } from "../field-util.js";
import { assert, log2 } from "../util.js";

const { p } = Field;
let b = Field.bitLength;

const w = 29n;
const n = Math.ceil(b / Number(w));

// let x = Random.randomField();
let x =
  21055668057744206722049915034365825947141946607484548719881883519400681427846n;
let z = modInverse(x, p);

assert(mod(z * x, p) === 1n);

let [r, k] = almostInverse(x, p, w, n);

// assert(k + 1n >= b && k < 2 * b, "k bounds");
// assert(r < p, "r < p");

assert(mod(x * r - (1n << k), p) === 0n, "almost inverse");

function almostInverse(a: bigint, p: bigint, w: bigint, n: number) {
  let u = -p;
  let v = a;
  let r = 0n;
  let s = 1n;
  let k = 0n;

  for (let i = 0; i < 2 * n; i++) {
    for (let j = 0; j < w; j++) {
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
        if (m <= 0n) {
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
      assert(v * r - u * s === 2n ** k * p, "linear combination");
      assert(mod(a * r - u, p) === 0n, "mod p, r");
      assert(mod(a * s - v, p) === 0n, "mod p, s");
    }
    if (u === 0n) break;
  }
  return [s, k];
}
