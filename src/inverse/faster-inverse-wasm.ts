import {
  localArray,
  func,
  type Func,
  type JSFunction,
  i32,
  i64,
  local,
  block,
  loop,
  if_,
  return_,
  call,
  type Local,
  $,
  drop,
  br,
  br_if,
  importFunc,
  select,
  v128,
  unreachable,
  i64x2,
} from "wasmati";
import { ImplicitMemory, forLoop1 } from "../wasm/wasm-util.ts";
import { type FieldWithMultiply } from "../wasm/multiply-montgomery.ts";
import { extractBitSlice } from "../wasm/field-helpers.ts";
import { inverse as bigintInverse } from "../bigint/field.ts";
import { mod } from "../bigint/field-util.ts";
import { assert } from "../util.ts";

export { fastInverse };

function fastInverse(implicitMemory: ImplicitMemory, Field: FieldWithMultiply) {
  let { w, n } = Field;

  const getBitLength = func(
    { in: [{ x: i32 }], locals: { xi: i32 }, out: [i32] },
    ({ x }, { xi }) => {
      Field.forEachReversed((i) => {
        local.set(xi, Field.i32.loadLimb(x, i));
        let isNonZero = i32.ne(xi, 0);
        if_(null, () => {
          let lengthLimb = i32.sub(32, i32.clz(xi));
          let length = i32.add(lengthLimb, i * w);
          return_();
        });
      });
      i32.const(0);
    }
  );

  const extractBits = extractBitSlice(w, n);

  const hiBits = 63;

  const logHex = (...args: bigint[]) => console.log(...args.map(hex));
  const logBin = (...args: bigint[]) => console.log(...args.map(bin));

  const log64 = importFunc({ in: [{ value: i64 }], out: [] }, console.log);
  const log64Hex = importFunc({ in: [{ value: i64 }], out: [] }, logHex);
  const log64Bin = importFunc({ in: [{ value: i64 }], out: [] }, logBin);
  const log64x2 = importFunc(
    { in: [{ value0: i64 }, { value1: i64 }], out: [] },
    console.log
  );
  const log64x4 = importFunc(
    {
      in: [{ value0: i64 }, { value1: i64 }, { value2: i64 }, { value3: i64 }],
      out: [],
    },
    console.log
  );
  const log64x4Hex = importFunc(
    {
      in: [{ value0: i64 }, { value1: i64 }, { value2: i64 }, { value3: i64 }],
      out: [],
    },
    logHex
  );
  const log64x4Bin = importFunc(
    {
      in: [{ value0: i64 }, { value1: i64 }, { value2: i64 }, { value3: i64 }],
      out: [],
    },
    logBin
  );

  const { wn, wordMax, P, size } = Field;
  const mu = bigintInverse(-Field.p, 1n << wn);
  // For an input xR, REDC((xR)^-1 * R^3) = x^-1 * R is the Montgomery inverse.
  const correctionPtr = implicitMemory.dataToOffset(
    Field.bigintToData(mod(Field.R ** 3n, Field.p))
  );

  // One limb of X = (x*f - y*g) / 2^w. For remainders the low limb is zero;
  // for coefficients, m*p is added first to make the division exact mod p.
  // Matrix rows satisfy |f| + |g| <= 2^w, so every limb sum stays below 2^60.
  function linearLimb(
    j: number,
    xj: Local<i64>,
    yj: Local<i64>,
    f: Local<i64>,
    g: Local<i64>,
    X: Local<i64>[],
    carry: Local<i64>,
    tmp: Local<i64>,
    m?: Local<i64>
  ) {
    i64.sub(i64.mul(xj, f), i64.mul(yj, g));
    if (j > 0) i64.add($, carry);
    if (m !== undefined) {
      local.set(tmp, $);
      if (j === 0) local.set(m, i64.and(i64.mul(tmp, mu), wordMax));
      i64.add(tmp, i64.mul(m, P[j]));
    }
    Field.carrySigned($, tmp);
    if (j > 0) local.set(X[j - 1], $);
    else drop();
    local.set(carry, $);
  }
  // X = (x*f0 - y*g0) / 2^w, Y = (y*g1 - x*f1) / 2^w. The top limbs hold
  // signed carries.
  function linearPair(
    x: Local<i32>,
    y: Local<i32>,
    [f0, g0, f1, g1]: Local<i64>[],
    X: Local<i64>[],
    Y: Local<i64>[],
    [xj, yj, carryX, carryY, tmp]: Local<i64>[],
    m?: [Local<i64>, Local<i64>]
  ) {
    for (let j = 0; j < n; j++) {
      local.set(xj, Field.loadLimb(x, j));
      local.set(yj, Field.loadLimb(y, j));
      linearLimb(j, xj, yj, f0, g0, X, carryX, tmp, m?.[0]);
      linearLimb(j, yj, xj, g1, f1, Y, carryY, tmp, m?.[1]);
    }
    local.set(X[n - 1], carryX);
    local.set(Y[n - 1], carryY);
  }
  function negate(X: Local<i64>[], carry: Local<i64>, tmp: Local<i64>) {
    for (let j = 0; j < n - 1; j++) {
      i64.sub(j === 0 ? 0n : carry, X[j]);
      Field.carrySigned($, tmp);
      local.set(X[j], $);
      local.set(carry, $);
    }
    local.set(X[n - 1], i64.sub(n > 1 ? carry : 0n, X[n - 1]));
  }
  // Coefficients are in (-p, 2p) after an update; store them canonically.
  function storeCoefficient(
    x: Local<i32>,
    X: Local<i64>[],
    carry: Local<i64>,
    tmp: Local<i64>
  ) {
    i64.lt_s(X[n - 1], 0n);
    if_(null, () => {
      for (let j = 0; j < n - 1; j++) {
        i64.add(X[j], P[j]);
        if (j > 0) i64.add($, carry);
        Field.carrySigned($, tmp);
        local.set(X[j], $);
        local.set(carry, $);
      }
      i64.add(X[n - 1], P[n - 1]);
      if (n > 1) i64.add($, carry);
      local.set(X[n - 1], $);
    });
    Field.store(x, X);
    call(Field.reduce, { x });
  }

  /**
   * Montgomery inverse, xR -> x^-1 R.
   *
   * Binary GCD on (u, v) = (p, a), accumulating w steps at a time in a 2x2
   * matrix using high/low approximations of u and v, then applying the
   * matrix to the full remainders and coefficients. A negative remainder
   * is negated together with its matrix row. Coefficients are divided by 2^w
   * modulo p in every batch, which keeps a*r = u and a*s = v (mod p).
   *
   * Needs three field elements of scratch, disjoint from input and output.
   * Output may alias the input. Traps on zero and nonunits. The output
   * parameter r holds the coefficient s; local r is the other one.
   */
  const inverse = func(
    {
      in: [{ scratch: i32 }, { r: i32 }, { a: i32 }],
      locals: {
        v: i32,
        u: i32,
        r: i32,
        ulen: i32,
        tmp32: i32,
        uhi: i64,
        vhi: i64,
        ulo: i64,
        vlo: i64,
        f0g0: v128,
        f1g1: v128,
        f0: i64,
        g0: i64,
        f1: i64,
        g1: i64,
        xj: i64,
        yj: i64,
        carryX: i64,
        carryY: i64,
        tmp: i64,
        mX: i64,
        mY: i64,
        X: localArray(i64, n),
        Y: localArray(i64, n),
      },
      out: [],
    },
    (
      { scratch, r: s, a },
      {
        v,
        u,
        r,
        ulen,
        tmp32,
        uhi,
        vhi,
        ulo,
        vlo,
        f0g0,
        f1g1,
        f0,
        g0,
        f1,
        g1,
        xj,
        yj,
        carryX,
        carryY,
        tmp,
        mX,
        mY,
        X,
        Y,
      }
    ) => {
      const matrix = [f0, g0, f1, g1];
      const temps = [xj, yj, carryX, carryY, tmp];
      local.set(v, scratch);
      local.set(u, i32.add(scratch, size));
      local.set(r, i32.add(scratch, 2 * size));

      // v = a, u = p, r = 0, s = 1
      Field.copyInline(v, a);
      call(Field.reduce, { x: v });
      call(Field.isZero, { x: v });
      if_(null, () => unreachable());
      Field.i32.store(u, Field.i32.P);
      Field.i32.store(r, Field.i32.Zero);
      Field.i32.store(s, Field.i32.One);

      block(null, (done) => {
        loop(null, (again) => {
          local.set(f0g0, v128.const("i64x2", [1n, 0n]));
          local.set(f1g1, v128.const("i64x2", [0n, 1n]));

          local.set(ulo, Field.loadLimb(u, 0));
          local.set(vlo, Field.loadLimb(v, 0));

          // max(len(u), len(v))
          let vlen = tmp32;
          call(getBitLength, { x: u });
          local.tee(ulen);
          call(getBitLength, { x: v });
          local.tee(vlen);
          i32.gt_u(ulen, vlen);
          select(i32);
          local.set(ulen);

          local.set(uhi, extractHiBits(u, ulen, hiBits, tmp32));
          local.set(vhi, extractHiBits(v, ulen, hiBits, tmp32));

          for (let j = 0; j < w; j++) {
            // if ((ulo & 1n) === 0n)
            i64.eqz(i64.and(ulo, 1n));
            if_(
              null,
              () => {
                local.set(uhi, i64.shr_s(uhi, 1n));
                local.set(ulo, i64.shr_s(ulo, 1n));
                local.set(f1g1, i64x2.shl(f1g1, 1));
              },
              () => {
                // if ((vlo & 1n) === 0n)
                i64.eqz(i64.and(vlo, 1n));
                if_(
                  null,
                  () => {
                    local.set(vhi, i64.shr_s(vhi, 1n));
                    local.set(vlo, i64.shr_s(vlo, 1n));
                    local.set(f0g0, i64x2.shl(f0g0, 1));
                  },
                  () => {
                    i64.le_s(vhi, uhi);
                    if_(
                      null,
                      () => {
                        local.set(uhi, i64.shr_s(i64.sub(uhi, vhi), 1n));
                        local.set(ulo, i64.shr_s(i64.sub(ulo, vlo), 1n));
                        local.set(f0g0, i64x2.add(f0g0, f1g1));
                        local.set(f1g1, i64x2.shl(f1g1, 1));
                      },
                      () => {
                        local.set(vhi, i64.shr_s(i64.sub(vhi, uhi), 1n));
                        local.set(vlo, i64.shr_s(i64.sub(vlo, ulo), 1n));
                        local.set(f1g1, i64x2.add(f0g0, f1g1));
                        local.set(f0g0, i64x2.shl(f0g0, 1));
                      }
                    );
                  }
                );
              }
            );
          }
          local.set(f0, i64x2.extract_lane(0, f0g0));
          local.set(g0, i64x2.extract_lane(1, f0g0));
          local.set(f1, i64x2.extract_lane(0, f1g1));
          local.set(g1, i64x2.extract_lane(1, f1g1));

          // u = (u*f0 - v*g0) / 2^w, v = (v*g1 - u*f1) / 2^w
          linearPair(u, v, matrix, X, Y, temps);
          i64.lt_s(X[n - 1], 0n);
          if_(null, () => {
            negate(X, carryX, tmp);
            local.set(f0, i64.sub(0n, f0));
            local.set(g0, i64.sub(0n, g0));
          });
          i64.lt_s(Y[n - 1], 0n);
          if_(null, () => {
            negate(Y, carryY, tmp);
            local.set(f1, i64.sub(0n, f1));
            local.set(g1, i64.sub(0n, g1));
          });
          Field.store(u, X);
          Field.store(v, Y);

          // r = (r*f0 - s*g0) / 2^w, s = (s*g1 - r*f1) / 2^w (mod p)
          linearPair(r, s, matrix, X, Y, temps, [mX, mY]);
          storeCoefficient(r, X, carryX, tmp);
          storeCoefficient(s, Y, carryY, tmp);

          // u = 0 => v = gcd and a*s = v
          call(Field.isZero, { x: u });
          br_if(done);
          // v = 0 => u = gcd and a*r = u
          call(Field.isZero, { x: v });
          if_(null, () => {
            Field.copyInline(s, r);
            Field.copyInline(v, u);
            br(done);
          });
          br(again);
        });
      });
      // gcd must be one. This also rejects nonunits of an odd composite modulus.
      i64.ne(Field.loadLimb(v, 0), 1n);
      for (let j = 1; j < n; j++) {
        i64.ne(Field.loadLimb(v, j), 0n);
        i32.or();
      }
      if_(null, () => unreachable());
      call(Field.multiply, { xy: s, x: s, y: correctionPtr });
    }
  );

  function extractHiBits(
    u: Local<i32>,
    ulen: Local<i32>,
    hiBits: number,
    hiStart: Local<i32>
  ) {
    assert(hiBits > 50);
    local.set(hiStart, i32.sub(ulen, hiBits));
    i32.lt_s(hiStart, 0);
    if_(null, () => {
      local.set(hiStart, 0);
    });
    call(extractBits, { x: u, startBit: hiStart, bitLength: 25 });
    i64.extend_i32_u();
    call(extractBits, { x: u, startBit: i32.add(hiStart, 25), bitLength: 25 });
    i64.shl(i64.extend_i32_u(), 25n);
    call(extractBits, {
      x: u,
      startBit: i32.add(hiStart, 50),
      bitLength: hiBits - 50,
    });
    i64.shl(i64.extend_i32_u(), 50n);
    i64.or();
    return i64.or();
  }

  return { inverse, getBitLength };
}

function hex(m: bigint) {
  return "0x" + m.toString(16);
}
function bin(m: bigint) {
  return "0b" + m.toString(2);
}
