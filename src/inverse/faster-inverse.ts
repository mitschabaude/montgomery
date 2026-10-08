import { Module, memory } from "wasmati";
import { Pallas } from "../concrete/pasta.ts";
import { mod } from "../bigint/field-util.ts";
import { inverse as inverseMod } from "../bigint/field.ts";
import { assert, log2 } from "../util.ts";
import { ImplicitMemory } from "../wasm/wasm-util.ts";
import { fastInverse } from "../wasm/fast-inverse.ts";
import { FieldWithArithmetic } from "../wasm/field-arithmetic.ts";
import { multiplyMontgomery } from "../wasm/multiply-montgomery.ts";
import { memoryHelpers } from "../wasm/memory-helpers.ts";
import { randomGenerators } from "../bigint/field-random.ts";

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

  let [s0, signFlip] = inverse(x0, p, BigInt(w), n);
  signFlips += Number(signFlip);
  assert(mod(x0 * s0, p) === 1n, "inverse");

  wasm.writeBigint(x, x0);
  wasm.inverse(scratch[0], s, x);
  let s1 = mod(wasm.readBigint(s), p);

  if (verbose) console.log({ i, s0, s1 });

  assert(s1 === mod(s0 * Field0.R * Field0.R, p), "equal results");
}

console.log(`${(signFlips / N) * 100}% flips`);

function inverse(a: bigint, p: bigint, w: bigint, n: number) {
  let u = p;
  let v = a;
  let r = 0n;
  let s = 1n;
  let signFlip = false;
  let wInv = mod(inverseMod(1n << w, p), p);

  for (let i = 0; ; i++) {
    let ulen = log2(u);
    let vlen = log2(v);
    if (verbose) console.log({ i, ulen, vlen });
    let [f0, g0] = [1n, 0n];
    let [f1, g1] = [0n, 1n];

    let ulo = u & ((1n << w) - 1n);
    let vlo = v & ((1n << w) - 1n);

    let shift = BigInt(Math.max(ulen, vlen)) - hiBits;
    if (shift < 0n) shift = 0n;

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
    }
    assert(f0 + g0 <= 1n << w && f1 + g1 <= 1n << w);

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
    // coefficients are divided by 2^w mod p, so a*r = u and a*s = v (mod p)
    [r, s] = [
      mod((r * f0 - s * g0) * wInv, p),
      mod((s * g1 - r * f1) * wInv, p),
    ];

    assert(mod(a * r - u, p) === 0n, "mod p, r");
    assert(mod(a * s - v, p) === 0n, "mod p, s");

    if (u === 0n) break;
    if (v === 0n) {
      [s, v] = [r, u];
      break;
    }
  }
  assert(v === 1n, "gcd");
  return [s, signFlip] as const;
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
