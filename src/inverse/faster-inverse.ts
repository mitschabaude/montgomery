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

console.log({ k });

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
    console.log({ i, u, v, r, s });
    let [f0, g0] = [1n, 0n];
    let [f1, g1] = [0n, 1n];

    let ustart = u;
    let vstart = v;

    let ulo = u & ((1n << w) - 1n);
    let vlo = v & ((1n << w) - 1n);

    for (let j = 0n; j < w; j++) {
      if ((u & (1n << j)) === 0n) {
        // console.log("reduce u");
        v <<= 1n;
        [f1, g1] = [f1 << 1n, g1 << 1n];
      } else if ((v & (1n << j)) === 0n) {
        // console.log("reduce v");
        u <<= 1n;
        [f0, g0] = [f0 << 1n, g0 << 1n];
      } else {
        let m = u + v;
        // console.log({ u, v, m, k });
        if (m <= 0n) {
          u = m;
          f0 = f0 + f1;
          g0 = g0 + g1;
          v <<= 1n;
          [f1, g1] = [f1 << 1n, g1 << 1n];
        } else {
          v = m;
          f1 = f0 + f1;
          g1 = g0 + g1;
          u <<= 1n;
          [f0, g0] = [f0 << 1n, g0 << 1n];
        }
      }
      k++;
    }

    let unew = ustart * f0 + vstart * g0;
    let vnew = ustart * f1 + vstart * g1;

    assert(u === unew);
    assert(v === vnew);

    assert((unew & ((1n << w) - 1n)) === 0n);
    assert((vnew & ((1n << w) - 1n)) === 0n);
    u = unew >> w;
    v = vnew >> w;

    [r, s] = [r * f0 + s * g0, r * f1 + s * g1];

    assert(v * r - u * s === p, "linear combination");
    assert(mod(a * r - u * 2n ** k, p) === 0n, "mod p, r");
    assert(mod(a * s - v * 2n ** k, p) === 0n, "mod p, s");

    if (u === 0n) break;
  }
  return [s, k];
}
