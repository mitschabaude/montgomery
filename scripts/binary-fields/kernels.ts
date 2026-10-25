/**
 * GF(2^128) multiplication in Wasm without carry-less multiply instructions.
 *
 * Polynomial basis mod x^128 + x^7 + x^2 + x + 1 (see ./reference.ts), elements as two
 * little-endian i64 words:
 * - `masked`: 64x64 carry-less products from integer multiplies of operands masked to every
 *   4th bit (BearSSL's ctmul64), low halves only, high halves through bit reversal.
 *   Needs only `i64.mul`.
 * - `wide`: the same idea with every 5th bit, so the full 128-bit product of `i64.mul_wide_u`
 *   has no carry collisions and no bit reversal is needed.
 * - `table4`, `table8`: multiplication by a fixed element h from precomputed tables of
 *   (w-bit window) * x^(w k) * h, one table lookup and xor per window.
 *
 * - `bitsliced`: 128 products at once on bit-planes (v128 j holds bit j of 128 elements),
 *   Karatsuba down to 8x8 schoolbook blocks of v128 and/xor, then reduction by xors.
 *
 * Fan–Paar tower basis (CompPoly's `FastBT128`):
 * - `tower`: Karatsuba ladder down to a 64 KiB GF(2^8) product table.
 */
import {
  $,
  type Local,
  Module,
  func,
  i32,
  i64,
  i8x16,
  local,
  localArray,
  memory,
  v128,
} from "wasmati";
import { forLoop1 } from "../../src/wasm/wasm-util.ts";

export { createModules, layout };

const layout = {
  towerMul8: 0, // 64 KiB GF(2^8) tower product table
  towerMulZ3: 1 << 16, // 256 B, multiplication by the GF(2^8) generator
  table4: (1 << 16) + 256, // 32 tables x 16 entries x 16 B = 8 KiB
  table8: (1 << 16) + 256 + (1 << 13), // 16 tables x 256 entries x 16 B = 64 KiB
  bitsliced: (1 << 17) + 256 + (1 << 13), // intermediate bit-planes, 80 KiB
  scratch: (1 << 17) + 256 + (1 << 13) + 80 * 1024,
  pages: 16,
};

type Pair = [Local<i64>, Local<i64>];

// straight-line code takes fresh locals from a pool; optimizing tiers treat them as SSA values
function pool<T extends Local<any>>(locals: T[]) {
  let next = 0;
  return () => {
    if (next === locals.length) throw Error("local pool exhausted");
    return locals[next++];
  };
}

function definer(L: Local<i64>[]) {
  let fresh = pool(L);
  return (value: unknown) => {
    let t = fresh();
    local.set(t, value as any);
    return t;
  };
}

type Def = ReturnType<typeof definer>;

const everyNth = (n: number, c: number) => {
  let m = 0n;
  for (let i = c; i < 64; i += n) m |= 1n << BigInt(i);
  return m;
};

// low 64 bits of the carry-less product: with every 4th bit, a product position collects
// at most 16 ones, and only the positions >= 64 can see 16, so truncation hides the carry
function clmulLow(def: Def, x: Local<i64>, y: Local<i64>) {
  let m = [0, 1, 2, 3].map((c) => everyNth(4, c));
  let xs = m.map((mc) => def(i64.and(x, mc)));
  let ys = m.map((mc) => def(i64.and(y, mc)));
  let z = [0, 1, 2, 3].map((c) => {
    let acc = def(i64.mul(xs[0], ys[c]));
    for (let a = 1; a < 4; a++)
      acc = def(i64.xor(acc, i64.mul(xs[a], ys[(c - a + 4) % 4])));
    return def(i64.and(acc, m[c]));
  });
  return def(i64.or(i64.or(z[0], z[1]), i64.or(z[2], z[3])));
}

function reverse64(def: Def, v: Local<i64>) {
  for (let [shift, mask] of [
    [1n, 0x5555555555555555n],
    [2n, 0x3333333333333333n],
    [4n, 0x0f0f0f0f0f0f0f0fn],
    [8n, 0x00ff00ff00ff00ffn],
    [16n, 0x0000ffff0000ffffn],
  ] as const) {
    v = def(
      i64.or(
        i64.and(i64.shr_u(v, shift), mask),
        i64.shl(i64.and(v, mask), shift),
      ),
    );
  }
  return def(i64.rotl(v, 32n));
}

// Karatsuba over clmulLow, high halves as rev(clmulLow(rev x, rev y)) >> 1
function mulMasked(def: Def, [a0, a1]: Pair, [b0, b1]: Pair) {
  let a2 = def(i64.xor(a0, a1));
  let b2 = def(i64.xor(b0, b1));
  let [ra0, ra1, rb0, rb1] = [a0, a1, b0, b1].map((v) => reverse64(def, v));
  let ra2 = def(i64.xor(ra0, ra1));
  let rb2 = def(i64.xor(rb0, rb1));
  let lo = [
    clmulLow(def, a0, b0),
    clmulLow(def, a1, b1),
    clmulLow(def, a2, b2),
  ];
  let hi = [
    clmulLow(def, ra0, rb0),
    clmulLow(def, ra1, rb1),
    clmulLow(def, ra2, rb2),
  ].map((r) => def(i64.shr_u(reverse64(def, r), 1n)));
  return karatsubaReduce(def, [lo[0], hi[0]], [lo[1], hi[1]], [lo[2], hi[2]]);
}

// full 128-bit carry-less product: with every 5th bit, a position collects at most 13 ones,
// whose carries stay below the next position of the same class
function clmulWide(def: Def, x: Local<i64>, y: Local<i64>): Pair {
  let m = [0, 1, 2, 3, 4].map((c) => everyNth(5, c));
  let xs = m.map((mc) => def(i64.and(x, mc)));
  let ys = m.map((mc) => def(i64.and(y, mc)));
  let lo: Local<i64>[] = [];
  let hi: Local<i64>[] = [];
  for (let c = 0; c < 5; c++) {
    let accLo: Local<i64> | undefined;
    let accHi: Local<i64> | undefined;
    for (let a = 0; a < 5; a++) {
      i64.mul_wide_u(xs[a], ys[(c - a + 5) % 5]);
      let pHi = def($);
      let pLo = def($);
      accLo = accLo === undefined ? pLo : def(i64.xor(accLo, pLo));
      accHi = accHi === undefined ? pHi : def(i64.xor(accHi, pHi));
    }
    // bit 64 + j is in class c iff j is in class c + 1, since 64 = 4 mod 5
    lo.push(def(i64.and(accLo!, m[c])));
    hi.push(def(i64.and(accHi!, m[(c + 1) % 5])));
  }
  let or = (v: Local<i64>[]) =>
    def(i64.or(i64.or(i64.or(v[0], v[1]), i64.or(v[2], v[3])), v[4]));
  return [or(lo), or(hi)];
}

function mulWide(def: Def, [a0, a1]: Pair, [b0, b1]: Pair) {
  let p0 = clmulWide(def, a0, b0);
  let p2 = clmulWide(def, a1, b1);
  let p1 = clmulWide(def, def(i64.xor(a0, a1)), def(i64.xor(b0, b1)));
  return karatsubaReduce(def, p0, p2, p1);
}

// (p0 + (p1 - p0 - p2) X + p2 X^2) mod P, X = x^64
function karatsubaReduce(def: Def, p0: Pair, p2: Pair, p1: Pair): Pair {
  let mid0 = def(i64.xor(i64.xor(p1[0], p0[0]), p2[0]));
  let mid1 = def(i64.xor(i64.xor(p1[1], p0[1]), p2[1]));
  let z0 = p0[0];
  let z1 = def(i64.xor(p0[1], mid0));
  let z2 = def(i64.xor(p2[0], mid1));
  let z3 = p2[1];
  return reduce(def, z0, z1, z2, z3);
}

// z mod x^128 + x^7 + x^2 + x + 1: the high half times x^7 + x^2 + x + 1, whose own
// overflow (at most 7 bits) is folded into the high half first
function reduce(
  def: Def,
  z0: Local<i64>,
  z1: Local<i64>,
  z2: Local<i64>,
  z3: Local<i64>,
): Pair {
  let t = def(
    i64.xor(
      i64.xor(i64.shr_u(z3, 63n), i64.shr_u(z3, 62n)),
      i64.shr_u(z3, 57n),
    ),
  );
  let h0 = def(i64.xor(z2, t));
  let lo = def(
    i64.xor(
      i64.xor(i64.xor(z0, h0), i64.shl(h0, 1n)),
      i64.xor(i64.shl(h0, 2n), i64.shl(h0, 7n)),
    ),
  );
  let hi = def(
    i64.xor(
      i64.xor(i64.xor(z1, z3), i64.or(i64.shl(z3, 1n), i64.shr_u(h0, 63n))),
      i64.xor(
        i64.or(i64.shl(z3, 2n), i64.shr_u(h0, 62n)),
        i64.or(i64.shl(z3, 7n), i64.shr_u(h0, 57n)),
      ),
    ),
  );
  return [lo, hi];
}

// CompPoly's table ladder, values up to 32 bits in i32
function towerMul(I: () => Local<i32>) {
  let def = (value: unknown) => {
    let t = I();
    local.set(t, value as any);
    return t;
  };
  function mul(bits: number, a: Local<i32>, b: Local<i32>): Local<i32> {
    if (bits === 8)
      return def(
        i32.load8_u({ offset: layout.towerMul8 }, i32.or(i32.shl(a, 8), b)),
      );
    let h = bits / 2;
    let mask = (1 << h) - 1;
    let [a0, a1, b0, b1] = [
      def(i32.and(a, mask)),
      def(i32.shr_u(a, h)),
      def(i32.and(b, mask)),
      def(i32.shr_u(b, h)),
    ];
    let p0 = mul(h, a0, b0);
    let p2 = mul(h, a1, b1);
    let p1 = mul(h, def(i32.xor(a0, a1)), def(i32.xor(b0, b1)));
    let lo = def(i32.xor(p0, p2));
    return def(i32.or(i32.shl(i32.xor(i32.xor(p1, lo), mulByZ(h, p2)), h), lo));
  }
  // v times the top generator of its level
  function mulByZ(bits: number, v: Local<i32>): Local<i32> {
    if (bits === 8) return def(i32.load8_u({ offset: layout.towerMulZ3 }, v));
    let h = bits / 2;
    let v0 = def(i32.and(v, (1 << h) - 1));
    let v1 = def(i32.shr_u(v, h));
    return def(i32.or(i32.shl(i32.xor(v0, mulByZ(h, v1)), h), v1));
  }
  return { mul, mulByZ };
}

function mulTower(
  def: Def,
  I: () => Local<i32>,
  [a0, a1]: Pair,
  [b0, b1]: Pair,
) {
  let { mul, mulByZ } = towerMul(I);
  let def32 = (value: unknown) => {
    let t = I();
    local.set(t, value as any);
    return t;
  };
  let halves = (v: Local<i64>) =>
    [def32(i32.wrap_i64(v)), def32(i32.wrap_i64(i64.shr_u(v, 32n)))] as const;
  let join = (lo: Local<i32>, hi: Local<i32>) =>
    def(i64.or(i64.shl(i64.extend_i32_u(hi), 32n), i64.extend_i32_u(lo)));
  function mul64(a: Local<i64>, b: Local<i64>) {
    let [x0, x1] = halves(a);
    let [y0, y1] = halves(b);
    let p0 = mul(32, x0, y0);
    let p2 = mul(32, x1, y1);
    let p1 = mul(32, def32(i32.xor(x0, x1)), def32(i32.xor(y0, y1)));
    let lo = def32(i32.xor(p0, p2));
    return join(lo, def32(i32.xor(i32.xor(p1, lo), mulByZ(32, p2))));
  }
  let p0 = mul64(a0, b0);
  let p2 = mul64(a1, b1);
  let p1 = mul64(def(i64.xor(a0, a1)), def(i64.xor(b0, b1)));
  let lo = def(i64.xor(p0, p2));
  // p2 times the GF(2^64) generator
  let [v0, v1] = halves(p2);
  let p2Z = join(v1, def32(i32.xor(v0, mulByZ(32, v1))));
  return [lo, def(i64.xor(i64.xor(p1, lo), p2Z))] as Pair;
}

// z = x * h for the window-w tables at `table`: xor of one entry per window of x
function mulTable(
  V: () => Local<v128>,
  w: 4 | 8,
  table: number,
  x: Local<v128>,
) {
  let windows = 128 / w;
  let tableSize = (1 << w) * 16;
  let acc: Local<v128> | undefined;
  for (let k = 0; k < windows; k++) {
    let byte = i8x16.extract_lane_u((k * w) >> 3, x);
    let index =
      w === 8 ? byte : (k & 1) === 0 ? i32.and(byte, 15) : i32.shr_u(byte, 4);
    let entry = v128.load({ offset: table + k * tableSize }, i32.shl(index, 4));
    let t = V();
    local.set(t, acc === undefined ? entry : v128.xor(acc, entry));
    acc = t;
  }
  return acc!;
}

type Binary = (def: Def, I: () => Local<i32>, a: Pair, b: Pair) => Pair;

const binaryKernels: Record<string, Binary> = {
  masked: (def, _, a, b) => mulMasked(def, a, b),
  tower: (def, I, a, b) => mulTower(def, I, a, b),
};

// latency: x <- x * c, n times; throughput: z[i] = x[i] * y[i]
function binaryFuncs(kernel: Binary) {
  const locals = {
    L: localArray(i64, 700),
    I: localArray(i32, 700),
    i: i32,
    p: i32,
  };
  let latency = func(
    { in: [{ x: i32 }, { c: i32 }, { n: i32 }], locals, out: [] },
    ({ x, c, n }, { L, I, i }) => {
      let [x0, x1, c0, c1] = L.slice(0, 4);
      local.set(x0, i64.load({}, x));
      local.set(x1, i64.load({ offset: 8 }, x));
      local.set(c0, i64.load({}, c));
      local.set(c1, i64.load({ offset: 8 }, c));
      forLoop1(i, 0, n, () => {
        let [z0, z1] = kernel(definer(L.slice(4)), pool(I), [x0, x1], [c0, c1]);
        local.set(x0, z0);
        local.set(x1, z1);
      });
      i64.store({}, x, x0);
      i64.store({ offset: 8 }, x, x1);
    },
  );
  let throughput = func(
    {
      in: [{ z: i32 }, { x: i32 }, { y: i32 }, { n: i32 }],
      locals,
      out: [],
    },
    ({ z, x, y, n }, { L, I, i, p }) => {
      forLoop1(i, 0, n, () => {
        let def = definer(L);
        local.set(p, i32.shl(i, 4));
        let at = (q: Local<i32>) => i32.add(q, p);
        let a: Pair = [
          def(i64.load({}, at(x))),
          def(i64.load({ offset: 8 }, at(x))),
        ];
        let b: Pair = [
          def(i64.load({}, at(y))),
          def(i64.load({ offset: 8 }, at(y))),
        ];
        let [z0, z1] = kernel(def, pool(I), a, b);
        i64.store({}, at(z), z0);
        i64.store({ offset: 8 }, at(z), z1);
      });
    },
  );
  return { latency, throughput };
}

function tableFuncs(w: 4 | 8) {
  let table = w === 4 ? layout.table4 : layout.table8;
  const locals = { V: localArray(v128, 40), i: i32 };
  let latency = func(
    { in: [{ x: i32 }, { n: i32 }], locals, out: [] },
    ({ x, n }, { V, i }) => {
      let acc = V[0];
      local.set(acc, v128.load({}, x));
      forLoop1(i, 0, n, () => {
        local.set(acc, mulTable(pool(V.slice(1)), w, table, acc));
      });
      v128.store({}, x, acc);
    },
  );
  let throughput = func(
    {
      in: [{ z: i32 }, { x: i32 }, { n: i32 }],
      locals: { ...locals, p: i32 },
      out: [],
    },
    ({ z, x, n }, { V, i, p }) => {
      forLoop1(i, 0, n, () => {
        local.set(p, i32.shl(i, 4));
        local.set(V[0], v128.load({}, i32.add(x, p)));
        v128.store(
          {},
          i32.add(z, p),
          mulTable(pool(V.slice(1)), w, table, V[0]),
        );
      });
    },
  );
  // tables for h at `h`: entry e of window k is (e x^(w k)) h, built from the 128 values
  // x^m h at single-bit entries and xors of those
  let build = func(
    {
      in: [{ h: i32 }],
      locals: {
        lo: i64,
        hi: i64,
        carry: i64,
        m: i32,
        e: i32,
        k: i32,
        base: i32,
      },
      out: [],
    },
    ({ h }, { lo, hi, carry, m, e, k, base }) => {
      local.set(lo, i64.load({}, h));
      local.set(hi, i64.load({ offset: 8 }, h));
      forLoop1(m, 0, 128, () => {
        // entry 1 << (m % w) of window m / w
        local.set(
          base,
          i32.add(
            i32.mul(i32.div_u(m, w), (1 << w) * 16),
            i32.shl(i32.shl(1, i32.rem_u(m, w)), 4),
          ),
        );
        i64.store({ offset: table }, base, lo);
        i64.store({ offset: table + 8 }, base, hi);
        // (lo, hi) <- (lo, hi) * x
        local.set(carry, i64.shr_u(hi, 63n));
        local.set(hi, i64.or(i64.shl(hi, 1n), i64.shr_u(lo, 63n)));
        local.set(lo, i64.xor(i64.shl(lo, 1n), i64.mul(carry, 0x87n)));
      });
      forLoop1(k, 0, 128 / w, () => {
        local.set(base, i32.mul(k, (1 << w) * 16));
        v128.store({ offset: table }, base, v128.const("i64x2", [0n, 0n]));
        forLoop1(e, 3, 1 << w, () => {
          // entry e = entry (e without its lowest bit) xor entry (lowest bit), both done;
          // for powers of two this rewrites the entry with itself
          local.set(m, i32.and(e, i32.sub(e, 1)));
          v128.store(
            { offset: table },
            i32.add(base, i32.shl(e, 4)),
            v128.xor(
              v128.load({ offset: table }, i32.add(base, i32.shl(m, 4))),
              v128.load(
                { offset: table },
                i32.add(base, i32.shl(i32.xor(e, m), 4)),
              ),
            ),
          );
        });
      });
    },
  );
  return { latency, throughput, build };
}

// bit-planes: one v128 per bit position, bit e of the plane is that bit of element e
type Plane = () => unknown;

// C = A * B on bit-planes, pointers to 128 v128 each. Intermediate planes live in memory at
// layout.bitsliced, since products have far more planes than there are registers.
function bitslicedFunc() {
  return func(
    {
      in: [{ c: i32 }, { a: i32 }, { b: i32 }],
      locals: { V: localArray(v128, 17), t: v128 },
      out: [],
    },
    ({ c, a, b }, { V, t }) => {
      let next = layout.bitsliced;
      let alloc = (n: number) =>
        Array.from({ length: n }, () => (next += 16) - 16);
      let load = (slot: number) => v128.load({ offset: slot }, i32.const(0));
      // the address goes on the stack before the value
      let store = (slot: number, value: () => unknown) => {
        i32.const(0);
        value();
        v128.store({ offset: slot }, $, $);
      };
      let planes = (slots: number[]): Plane[] =>
        slots.map((slot) => () => load(slot));

      function schoolbook(x: Plane[], y: Plane[]) {
        let n = x.length;
        let out = alloc(2 * n - 1);
        let xs = V.slice(0, n);
        let ys = V.slice(n, 2 * n);
        x.forEach((get, i) => local.set(xs[i], get() as any));
        y.forEach((get, i) => local.set(ys[i], get() as any));
        let acc = V[2 * n];
        for (let k = 0; k < 2 * n - 1; k++) {
          for (let i = Math.max(0, k - n + 1); i <= Math.min(k, n - 1); i++) {
            let product = v128.and(xs[i], ys[k - i]);
            local.set(
              acc,
              i === Math.max(0, k - n + 1) ? product : v128.xor(acc, product),
            );
          }
          store(out[k], () => local.get(acc));
        }
        return out;
      }

      function karatsuba(x: Plane[], y: Plane[]): number[] {
        let n = x.length;
        if (n === 8) return schoolbook(x, y);
        let h = n / 2;
        let p0 = karatsuba(x.slice(0, h), y.slice(0, h));
        let p2 = karatsuba(x.slice(h), y.slice(h));
        let sums = (z: Plane[]) => {
          let slots = alloc(h);
          slots.forEach((slot, i) =>
            store(slot, () => v128.xor(z[i]() as any, z[i + h]() as any)),
          );
          return planes(slots);
        };
        let p1 = karatsuba(sums(x), sums(y));
        let out = alloc(4 * h - 1);
        for (let k = 0; k < 4 * h - 1; k++) {
          let terms: number[] = [];
          if (k < 2 * h - 1) terms.push(p0[k]);
          if (k >= 2 * h) terms.push(p2[k - 2 * h]);
          let m = k - h;
          if (m >= 0 && m < 2 * h - 1) terms.push(p1[m], p0[m], p2[m]);
          store(out[k], () => {
            if (terms.length === 0) return v128.const("i64x2", [0n, 0n]);
            let value = load(terms[0]);
            for (let slot of terms.slice(1))
              value = v128.xor(value, load(slot));
            return value;
          });
        }
        return out;
      }

      let input = (p: Local<i32>): Plane[] =>
        Array.from(
          { length: 128 },
          (_, i) => () => v128.load({ offset: 16 * i }, p),
        );
      let product = karatsuba(input(a), input(b));
      // x^j = x^(j-128) (x^7 + x^2 + x + 1), from the top so that folds above 127 cascade
      for (let j = 254; j >= 128; j--) {
        local.set(t, load(product[j]));
        for (let target of [j - 128, j - 127, j - 126, j - 121])
          store(product[target], () => v128.xor(load(product[target]), t));
      }
      for (let i = 0; i < 128; i++)
        v128.store({ offset: 16 * i }, c, load(product[i]));
      if (next > layout.scratch)
        throw Error("bitsliced intermediates overflow");
    },
  );
}

function createModules() {
  const mem = memory({ min: layout.pages, max: layout.pages });
  const masked = binaryFuncs(binaryKernels.masked);
  const tower = binaryFuncs(binaryKernels.tower);
  const t4 = tableFuncs(4);
  const t8 = tableFuncs(8);
  const portable = Module({
    memory: mem,
    exports: {
      memory: mem,
      maskedLatency: masked.latency,
      maskedThroughput: masked.throughput,
      towerLatency: tower.latency,
      towerThroughput: tower.throughput,
      table4Build: t4.build,
      table4Latency: t4.latency,
      table4Throughput: t4.throughput,
      table8Build: t8.build,
      table8Latency: t8.latency,
      table8Throughput: t8.throughput,
      bitsliced: bitslicedFunc(),
    },
  });
  const wideMemory = memory({ min: layout.pages, max: layout.pages });
  const wide = binaryFuncs((def, _, a, b) => mulWide(def, a, b));
  const wideModule = Module({
    memory: wideMemory,
    exports: {
      memory: wideMemory,
      wideLatency: wide.latency,
      wideThroughput: wide.throughput,
    },
  });
  return { portable, wide: wideModule };
}
