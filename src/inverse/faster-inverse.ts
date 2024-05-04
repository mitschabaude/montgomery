import { Module, memory } from "wasmati";
import { Pallas } from "../concrete/pasta.js";
import { mod } from "../bigint/field-util.js";
import { assert, log2 } from "../util.js";
import { ImplicitMemory } from "../wasm/wasm-util.js";
import { fastInverse } from "./faster-inverse-wasm.js";
import { FieldWithArithmetic } from "../wasm/field-arithmetic.js";
import { multiplyMontgomery } from "../wasm/multiply-montgomery.js";
import { memoryHelpers } from "../wasm/memory-helpers.js";
import { randomGenerators } from "../bigint/field-random.js";

const { p, w } = Pallas.Field;
let b = Pallas.Field.bitLength;
let { randomField } = randomGenerators(p);

const n = Math.ceil(b / w);
const hiBits = 63n;

const N = 1000;
const verbose = false;

// create wasm
let implicitMemory = new ImplicitMemory(memory({ min: 1 << 10 }));

let Field0 = FieldWithArithmetic(p, w, n);
let { multiply, square, leftShift } = multiplyMontgomery(p, w, n, {
  countMultiplications: false,
});
const Field1 = Object.assign(Field0, { multiply, square, leftShift });
let exports = fastInverse(implicitMemory, Field1);
let module = Module({
  exports: {
    ...implicitMemory.getExports(),
    ...exports,
  },
});
let wasm_ = (await module.instantiate()).instance.exports;
let wasm = { ...wasm_, ...memoryHelpers(p, w, n, wasm_) };

let signFlips = 0;

let [x, s] = wasm.global.getPointers(2);
let scratch = wasm.global.getPointers(10);
let x0 = (1n << 117n) - 1n;
wasm.writeBigint(x, x0);
let length = wasm.getBitLength(x);
assert(length === 117);

for (let i = 0; i < N; i++) {
  let x0 = randomField();
  // x0 =
  //   3644898569073079219285804017037847737335778255461247493887823044200058407990n;
  // x0 = (1n << 254n) + 1n;
  // console.log({ x0 });

  let [s0, k0, signFlip] = almostInverse(x0, p, BigInt(w), n);
  signFlips += Number(signFlip);

  assert(k0 + 1 >= b && k0 <= 2 * n * w, "k bounds");
  assert(s0 < p, "s < p");
  assert(mod(x0 * s0 - (1n << BigInt(k0)), p) === 0n, "almost inverse");

  wasm.writeBigint(x, x0);
  let k1 = wasm.almostInverse(scratch[0], s, x);
  let s1 = wasm.readBigint(s);

  if (verbose) console.log({ i, k0, k1, s0, s1 });

  assert(k0 === k1, "equal number of iterations");
  assert(s0 === s1, "equal results");
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
    if (verbose) console.log({ i, ulen, vlen, rlen: log2(r), slen: log2(s) });
    // console.log({ i, u, v, r, s });
    // console.log({
    //   s0: hex(s & Field0.wordMax),
    //   s1: hex((s >> w) & Field0.wordMax),
    // });
    let [f0, g0] = [1n, 0n];
    let [f1, g1] = [0n, 1n];

    let ulo = u & ((1n << w) - 1n);
    let vlo = v & ((1n << w) - 1n);

    let shift = BigInt(Math.max(ulen, vlen)) - hiBits;

    let uhi = u >> shift;
    let vhi = v >> shift;

    for (let j = 0n; j < w; j++) {
      if ((ulo & 1n) === 0n) {
        uhi >>= 1n;
        ulo >>= 1n;
        f1 <<= 1n;
        g1 <<= 1n;
      } else if ((vlo & 1n) === 0n) {
        vhi >>= 1n;
        vlo >>= 1n;
        f0 <<= 1n;
        g0 <<= 1n;
      } else {
        let mhi = vhi - uhi;
        if (mhi <= 0n) {
          uhi = -mhi >> 1n;
          ulo = (ulo - vlo) >> 1n;
          f0 = f0 + f1;
          g0 = g0 + g1;
          f1 <<= 1n;
          g1 <<= 1n;
        } else {
          vhi = mhi >> 1n;
          vlo = (vlo - ulo) >> 1n;
          f1 = f0 + f1;
          g1 = g0 + g1;
          f0 <<= 1n;
          g0 <<= 1n;
        }
      }
      k++;
    }

    assert(k === BigInt(i + 1) * w);
    assert(f0 <= 1n << w);

    let unew = u * f0 - v * g0;
    let vnew = v * g1 - u * f1;

    assert((unew & ((1n << w) - 1n)) === 0n);
    assert((vnew & ((1n << w) - 1n)) === 0n);

    u = unew >> w;
    v = vnew >> w;

    if (u < 0) {
      signFlip = true;
      [u, f0, g0] = [-u, -f0, -g0];
    }
    if (v < 0) {
      signFlip = true;
      [v, f1, g1] = [-v, -f1, -g1];
    }
    let rnew = r * f0 + s * g0;
    let snew = r * f1 + s * g1;
    [r, s] = [rnew, snew];

    let lin = v * r + u * s;
    assert(lin === p || lin === -p, "linear combination");
    assert(mod(a * r + u * 2n ** k, p) === 0n, "mod p, r");
    assert(mod(a * s - v * 2n ** k, p) === 0n, "mod p, s");

    if (u === 0n) break;
    if (v === 0n) throw Error("v = 0");
  }

  if (verbose) console.log({ u, v, rlen: log2(r), slen: log2(s) });
  // second case can only happen when sign flips and by chance v becomes 0
  // return [u === 0n ? s : mod(-r, p), k, signFlip] as const;

  // remove unnecessary low 0 bits in s
  let i = 0;
  while (i < w && (s & 1n) === 0n) {
    s >>= 1n;
    k--;
    i++;
  }
  return [s, Number(k), signFlip] as const;
}

function hex(m: bigint) {
  return "0x" + m.toString(16);
}
function bin(m: bigint) {
  return "0b" + m.toString(2);
}
function hi(m: bigint, bits: number) {
  return m >> BigInt(log2(m) - bits);
}
