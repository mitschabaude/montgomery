import { Field, Random } from "../concrete/pasta.js";
import { mod } from "../field-util.js";
import { assert, log2 } from "../util.js";

const { p } = Field;
let b = Field.bitLength;

const w = 32n;
const n = Math.ceil(b / Number(w));

const N = 100;
let signFlips = 0;

for (let i = 0; i < N; i++) {
  let x = Random.randomField();

  let [r, k, signFlip] = almostInverse(x, p, w, n);
  signFlips += Number(signFlip);

  console.log({ i, k });

  assert(k + 1n >= b && k < 2 * n * Number(w), "k bounds");
  assert(signFlip || r < p << w, "r < p*2^w");

  assert(mod(x * r - (1n << k), p) === 0n, "almost inverse");
}

console.log(`${(signFlips / N) * 100}% flips`);

function almostInverse(a: bigint, p: bigint, w: bigint, n: number) {
  let u = p;
  let v = a;
  let r = 0n;
  let s = 1n;
  let k = 0n;
  let signFlip = false;

  for (let i = 0; i < 2 * n; i++) {
    let ulen = log2(u);
    let vlen = log2(v);
    console.log({
      i,
      ulen,
      vlen,
      rlen: log2(r),
      slen: log2(s),
    });
    // console.log({ i, u, v, r, s });
    let [f0, g0] = [1n, 0n];
    let [f1, g1] = [0n, 1n];

    let ulo = u & ((1n << w) - 1n);
    let vlo = v & ((1n << w) - 1n);

    const hiBits = 64n;
    let shift = BigInt(ulen) - hiBits;

    let uhi = u >> shift;
    let vhi = v >> shift;

    for (let j = 0n; j < w; j++) {
      if ((ulo & 1n) === 0n) {
        ulo >>= 1n;
        uhi >>= 1n;
        [f1, g1] = [f1 << 1n, g1 << 1n];
      } else if ((vlo & 1n) === 0n) {
        vlo >>= 1n;
        vhi >>= 1n;
        [f0, g0] = [f0 << 1n, g0 << 1n];
      } else {
        let mhi = vhi - uhi;
        if (mhi <= 0n) {
          uhi = -mhi >> 1n;
          ulo = (ulo - vlo) >> 1n;
          f0 = f0 + f1;
          g0 = g0 + g1;
          [f1, g1] = [f1 << 1n, g1 << 1n];
        } else {
          vhi = mhi >> 1n;
          vlo = (vlo - ulo) >> 1n;
          f1 = f0 + f1;
          g1 = g0 + g1;
          [f0, g0] = [f0 << 1n, g0 << 1n];
        }
      }
      k++;
    }

    assert(k === BigInt(i + 1) * w);

    let unew = u * f0 - v * g0;
    let vnew = -u * f1 + v * g1;

    assert((unew & ((1n << w) - 1n)) === 0n);
    assert((vnew & ((1n << w) - 1n)) === 0n);

    u = unew >> w;
    v = vnew >> w;

    if (u < 0 || v < 0) {
      // throw Error("sign flip");
      signFlip = true;
      if (u < 0) {
        [u, f0, g0] = [-u, -f0, -g0];
      } else if (v < 0) {
        [v, f1, g1] = [-v, -f1, -g1];
      }
    }
    [r, s] = [r * f0 + s * g0, r * f1 + s * g1];

    let lin = v * r + u * s;
    assert(lin === p || lin === -p, "linear combination");
    assert(mod(a * r + u * 2n ** k, p) === 0n, "mod p, r");
    assert(mod(a * s - v * 2n ** k, p) === 0n, "mod p, s");

    if (u === 0n) break;
    if (v === 0n) throw Error("v = 0");
  }

  console.log({
    u,
    v,
    rlen: log2(r),
    slen: log2(s),
  });
  // second case can only happen when sign flips and by chance v becomes 0
  // return [u === 0n ? s : mod(-r, p), k, signFlip] as const;
  return [s, k, signFlip] as const;
}

function hex(m: bigint) {
  return "0x" + m.toString(16);
}
function hi(m: bigint, bits: number) {
  return m >> BigInt(log2(m) - bits);
}
