import {
  func,
  Func,
  JSFunction,
  i32,
  i64,
  local,
  memory,
  Module,
  loop,
  block,
  if_,
  return_,
  call,
  Local,
  $,
  drop,
  br_if,
  br,
  importFunc,
  select,
} from "wasmati";
import { ImplicitMemory, forLoop1 } from "../wasm/wasm-util.js";
import { FieldWithMultiply } from "../wasm/multiply-montgomery.js";
import { extractBitSlice } from "../wasm/field-helpers.js";
import { assert } from "../util.js";

export { fastInverse };

function fastInverse(implicitMemory: ImplicitMemory, Field: FieldWithMultiply) {
  let { w } = Field;

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

  const extractBits = extractBitSlice(w, Field.n);

  const hiBits = 63;

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
   * - v + u + r (scratch space - 2 + 1x2 = 4 field elements)
   * - s (output - 1x2 field elements)
   * - a (1 field element)
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
        l,
        k,
        ulen,
        uhi,
        vhi,
        ulo,
        vlo,
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

      // u = p, v = a, r = 0, s = 1
      Field.i32.store(u, Field.i32.P);
      Field.copyInline(v, a);
      // TODO fully zero out r,s
      Field.i32.store(r, Field.i32.Zero);
      Field.i32.store(s, Field.i32.One);

      block(null, ($break) => {
        forLoop1(i, 0, 2 * Field.n, () => {
          // initialize local variables
          local.set(f0, 1n);
          local.set(g0, 0n);
          local.set(f1, 0n);
          local.set(g1, 1n);

          local.set(ulo, Field.loadLimb(u, 0));
          local.set(vlo, Field.loadLimb(v, 0));

          let vlen = l;

          // max(len(u), len(v))
          call(getBitLength, [u]);
          local.tee(ulen);
          call(getBitLength, [v]);
          local.tee(vlen);
          i32.gt_u(ulen, vlen);
          select(i32);
          local.set(ulen);

          let tmp32 = l;
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
                local.set(f1, i64.shl(f1, 1n));
                local.set(g1, i64.shl(g1, 1n));
              },
              () => {
                // if ((vlo & 1n) === 0n)
                i64.eqz(i64.and(vlo, 1n));
                if_(
                  null,
                  () => {
                    local.set(vhi, i64.shr_s(vhi, 1n));
                    local.set(vlo, i64.shr_s(vlo, 1n));
                    local.set(f0, i64.shl(f0, 1n));
                    local.set(g0, i64.shl(g0, 1n));
                  },
                  () => {
                    i64.le_s(vhi, uhi);
                    if_(
                      null,
                      () => {
                        local.set(uhi, i64.shr_s(i64.sub(uhi, vhi), 1n));
                        local.set(ulo, i64.shr_s(i64.sub(ulo, vlo), 1n));
                        local.set(f0, i64.add(f0, f1));
                        local.set(g0, i64.add(g0, g1));
                        local.set(f1, i64.shl(f1, 1n));
                        local.set(g1, i64.shl(g1, 1n));
                      },
                      () => {
                        local.set(vhi, i64.shr_s(i64.sub(vhi, uhi), 1n));
                        local.set(vlo, i64.shr_s(i64.sub(vlo, ulo), 1n));
                        local.set(f1, i64.add(f0, f1));
                        local.set(g1, i64.add(g0, g1));
                        local.set(f0, i64.shl(f0, 1n));
                        local.set(g0, i64.shl(g0, 1n));
                      }
                    );
                  }
                );
              }
            );
            local.set(k, i32.add(k, 1));
          }

          // update u, v
          // u = (u * f0 - v * g0) >> w
          // v = (v * g1 - u * f1) >> w
          // note that we store j result at j-1 location, which is the shift
          local.set(carryu, 0n);
          local.set(carryv, 0n);
          for (let j = 0; j < Field.n; j++) {
            local.set(uj, Field.loadLimb(u, j));
            local.set(vj, Field.loadLimb(v, j));

            i64.sub(i64.mul(uj, f0), i64.mul(vj, g0));
            if (j > 0) i64.add($, carryu);
            Field.carrySigned($, tmp);
            if (j > 0) Field.storeLimb(u, j - 1, $);
            else drop();
            local.set(carryu);

            i64.sub(i64.mul(vj, g1), i64.mul(uj, f1));
            if (j > 0) i64.add($, carryv);
            Field.carrySigned($, tmp);
            if (j > 0) Field.storeLimb(v, j - 1, $);
            else drop();
            local.set(carryv);
          }
          Field.storeLimb(u, Field.n - 1, carryu);
          Field.storeLimb(v, Field.n - 1, carryv);

          // TODO handle sign flip

          // update r, s
          // r = r * f0 + s * g0
          // s = r * f1 + s * g1
          // this update makes r, s grow by at most 1 limb,
          // because fi, gi <= 2**w
          // r,s start at 1 bit
          // => after loop i they have at most (i + 1)w + 1 bits
          // => can safely store in (i + 1) limbs

          let [rl, sl, carryr, carrys] = [uj, vj, carryu, carryv]; // reuse locals
          local.set(carryr, 0n);
          local.set(carrys, 0n);
          local.set(l, 0);
          // for (l=0; l<4*(i+1); l+=4)
          block(null, ($break) => {
            loop(null, ($continue) => {
              i32.ge_s(l, i32.mul(i32.add(i, 1), 4));
              br_if($break);

              local.set(rl, i64.extend_i32_u(i32.load({}, i32.add(r, l))));
              local.set(sl, i64.extend_i32_u(i32.load({}, i32.add(s, l))));

              // r = r * f0 + s * g0
              i64.add(i64.mul(rl, f0), i64.mul(sl, g0));
              local.set(tmp, i64.add($, carryr));
              i32.store(
                {},
                i32.add(r, l),
                i32.wrap_i64(i64.and(tmp, Field.wordMax))
              );
              local.set(carryr, i64.shr_s(tmp, Field.wn));

              // s = r * f1 + s * g1;
              i64.add(i64.mul(rl, f1), i64.mul(sl, g1));
              local.set(tmp, i64.add($, carrys));
              i32.store(
                {},
                i32.add(s, l),
                i32.wrap_i64(i64.and(tmp, Field.wordMax))
              );
              local.set(carrys, i64.shr_s(tmp, Field.wn));

              local.set(l, i32.add(l, 4));
              br($continue);
            });
          });
          i32.store({}, i32.add(r, l), i32.wrap_i64(carryr));
          i32.store({}, i32.add(s, l), i32.wrap_i64(carrys));

          // break if u = 0 (=> s holds output)
          call(Field.isZero, [u]);
          br_if($break);
        });
      });

      local.get(k);
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

  return { almostInverse, getBitLength };
}

function hex(m: bigint) {
  return "0x" + m.toString(16);
}
function bin(m: bigint) {
  return "0b" + m.toString(2);
}
