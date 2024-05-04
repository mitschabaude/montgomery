import {
  func,
  Func,
  JSFunction,
  i32,
  i64,
  local,
  block,
  if_,
  return_,
  call,
  Local,
  $,
  drop,
  br_if,
  importFunc,
  select,
  memory,
  v128,
  i64x2,
} from "wasmati";
import { ImplicitMemory, forLoop1 } from "../wasm/wasm-util.js";
import { FieldWithMultiply } from "../wasm/multiply-montgomery.js";
import { extractBitSlice } from "../wasm/field-helpers.js";
import { assert } from "../util.js";

export { fastInverse };

function fastInverse(implicitMemory: ImplicitMemory, Field: FieldWithMultiply) {
  let { w, n } = Field;

  const getBitLength = func(
    { in: [i32], locals: [i32], out: [i32] },
    ([x], [xi]) => {
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

  // assumes input is n limbs, and we shift by at most 1 limb
  // also assumes that shifted result + additional hi limb again fits in n limbs
  const makeOdd = func(
    { in: [i32, i64], locals: [i64, i64, i64], out: [i32] },
    ([u, uhi], [k, l, tmp]) => {
      // k = count_trailing_zeros(u[0])
      local.tee(tmp, Field.loadLimb(u, 0));
      local.tee(k, i64.ctz($));
      i64.eqz();
      // if (k === 0) return; (the most common case)
      if_(null, () => {
        i32.const(0);
        return_();
      });

      // if k === 64, shift by a whole limb
      i64.eq(k, 64n);
      if_(null, () => {
        // copy u[1],...,u[n-1] --> u[0],...,u[n-2]
        local.get(u);
        i32.add(u, 4);
        i32.const((n - 1) * 4);
        memory.copy();

        // u[n-1] = uhi
        Field.storeLimb(u, n - 1, uhi);

        i32.const(w);
        return_();
      });

      // here we know that k \in 0,...,w-1
      // l = w - k
      local.set(l, i64.sub(Field.wn, k));

      // u >> k

      // for (let i = 0; i < n; i++) {
      //   u[i] = (u[i] >> k) | ((u[i + 1] << l) & wordMax);
      // }
      // u[n] = u[n] >> k;
      for (let i = 0; i < n - 1; i++) {
        i64.shr_u(tmp, k);
        local.tee(tmp, Field.loadLimb(u, i + 1));
        i64.shl($, l);
        i64.and($, Field.wordMax);
        i64.or();
        Field.storeLimb(u, i, $);
      }
      i64.shr_u(tmp, k);
      i64.shl(uhi, l);
      i64.and($, Field.wordMax);
      i64.or();
      Field.storeLimb(u, n - 1, $);

      // return k
      i32.wrap_i64(k);
    }
  );

  const extractBits = extractBitSlice(w, n);

  const hiBits = 63;
  const resultMaxLimbs = n + 1;

  const logHex = (...args: bigint[]) => console.log(...args.map(hex));
  const logBin = (...args: bigint[]) => console.log(...args.map(bin));

  const log64 = importFunc({ in: [i64], out: [] }, console.log);
  const log64Hex = importFunc({ in: [i64], out: [] }, logHex);
  const log64Bin = importFunc({ in: [i64], out: [] }, logBin);
  const log64x2 = importFunc({ in: [i64, i64], out: [] }, console.log);
  const log64x4 = importFunc(
    { in: [i64, i64, i64, i64], out: [] },
    console.log
  );
  const log64x4Hex = importFunc({ in: [i64, i64, i64, i64], out: [] }, logHex);
  const log64x4Bin = importFunc({ in: [i64, i64, i64, i64], out: [] }, logBin);

  /**
   * input: pointers for
   * - v + u + r (scratch space - 3 field elements)
   * - s (output - 1 field element)
   * - a (input - 1 field element)
   */
  const almostInverse = func(
    {
      in: [i32, i32, i32],
      locals: [
        i32,
        i32,
        i32,
        i32,
        i32,
        i32,
        i64,
        i64,
        i64,
        i64,
        v128,
        v128,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
      ],
      out: [i32],
    },
    (
      [v, s, a],
      [
        u,
        r,
        i,
        tmp32,
        k,
        ulen,
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
        uj,
        vj,
        carryu,
        carryv,
        tmp,
      ]
    ) => {
      // setup locals
      local.set(u, i32.add(v, Field.size));
      local.set(r, i32.add(u, Field.size));
      let [rj, sj, carryr, carrys] = [uj, vj, carryu, carryv]; // reused locals

      // u = p, v = a, r = 0, s = 1
      Field.i32.store(u, Field.i32.P);
      Field.copyInline(v, a);
      Field.i32.store(r, Field.i32.Zero);
      Field.i32.store(s, Field.i32.One);

      block(null, ($break) => {
        forLoop1(i, 0, 2 * n, () => {
          // initialize local variables
          local.set(f0g0, v128.const("i64x2", [1n, 0n]));
          local.set(f1g1, v128.const("i64x2", [0n, 1n]));

          local.set(ulo, Field.loadLimb(u, 0));
          local.set(vlo, Field.loadLimb(v, 0));

          let vlen = tmp32;

          // max(len(u), len(v))
          call(getBitLength, [u]);
          local.tee(ulen);
          call(getBitLength, [v]);
          local.tee(vlen);
          i32.gt_u(ulen, vlen);
          select(i32);
          local.set(ulen);

          local.set(uhi, extractHiBits(u, ulen, hiBits, tmp32));
          local.set(vhi, extractHiBits(v, ulen, hiBits, tmp32));

          // inner loop
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
            local.set(k, i32.add(k, 1));
          }
          local.get(f0g0);
          local.set(f0, i64x2.extract_lane(0));
          local.get(f0g0);
          local.set(g0, i64x2.extract_lane(1));

          local.get(f1g1);
          local.set(f1, i64x2.extract_lane(0));
          local.get(f1g1);
          local.set(g1, i64x2.extract_lane(1));

          // update u, v
          // u = (u * f0 - v * g0) >> w
          // v = (v * g1 - u * f1) >> w
          // note that we store j result at j-1 location, which is the shift
          let uIsZero = tmp32;
          local.set(uIsZero, 1);

          for (let j = 0; j < n; j++) {
            local.set(uj, Field.loadLimb(u, j));
            local.set(vj, Field.loadLimb(v, j));

            i64.sub(i64.mul(uj, f0), i64.mul(vj, g0));
            if (j > 0) i64.add($, carryu);
            Field.carrySigned($, tmp);
            local.tee(tmp);
            if (j > 0) Field.storeLimb(u, j - 1, $);
            else drop();
            local.set(carryu);

            // remember if u=0
            local.set(uIsZero, i32.and(uIsZero, i64.eqz(tmp)));

            i64.sub(i64.mul(vj, g1), i64.mul(uj, f1));
            if (j > 0) i64.add($, carryv);
            Field.carrySigned($, tmp);
            if (j > 0) Field.storeLimb(v, j - 1, $);
            else drop();
            local.set(carryv);
          }
          Field.storeLimb(u, n - 1, carryu);
          Field.storeLimb(v, n - 1, carryv);
          local.set(uIsZero, i32.and(uIsZero, i64.eqz(carryu)));

          // TODO handle sign flip

          // update r, s
          // r = r * f0 + s * g0
          // s = r * f1 + s * g1
          // assumes that r, s will only ever need n+1 limbs (TODO: proof)
          // we store s as n limbs plus a high carry limb which only gets shifted in at the end

          for (let j = 0; j < resultMaxLimbs - 1; j++) {
            local.set(rj, Field.loadLimb(r, j));
            local.set(sj, Field.loadLimb(s, j));

            i64.add(i64.mul(rj, f0), i64.mul(sj, g0));
            if (j > 0) i64.add($, carryr);
            Field.carrySigned($, tmp);
            Field.storeLimb(r, j, $);
            local.set(carryr);

            i64.add(i64.mul(rj, f1), i64.mul(sj, g1));
            if (j > 0) i64.add($, carrys);
            Field.carrySigned($, tmp);
            Field.storeLimb(s, j, $);
            local.set(carrys);
          }

          // break if u = 0 (=> s holds output)
          local.get(uIsZero);
          br_if($break);
        });
      });

      local.get(k);
      call(makeOdd, [s, carrys]);
      i32.sub();
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
    call(extractBits, [u, hiStart, 25]);
    i64.extend_i32_u();
    call(extractBits, [u, i32.add(hiStart, 25), 25]);
    i64.shl(i64.extend_i32_u(), 25n);
    call(extractBits, [u, i32.add(hiStart, 50), hiBits - 50]);
    i64.shl(i64.extend_i32_u(), 50n);
    i64.or();
    return i64.or();
  }

  return { almostInverse, getBitLength, makeOdd };
}

function hex(m: bigint) {
  return "0x" + m.toString(16);
}
function bin(m: bigint) {
  return "0b" + m.toString(2);
}
