import type * as W from "wasmati";
import {
  $,
  block,
  br,
  br_if,
  call,
  func,
  i32,
  i64,
  if_,
  local,
  loop,
  memory,
  return_,
  unreachable,
} from "wasmati";
import { mod } from "../bigint/field-util.ts";
import { ImplicitMemory } from "./wasm-util.ts";
import { type FieldWithMultiply } from "./multiply-montgomery.ts";
import { log2 } from "../util.ts";

export { fieldInverse };

function fieldInverse(
  implicitMemory: ImplicitMemory,
  Field: FieldWithMultiply
) {
  const { n, w, p, multiply } = Field;

  /**
   * a core building block for montgomery inversion
   *
   * takes u, s < p. sets k=0. while u is even, update u /= 2 and s *= 2 and increment k++
   * at the end, u <- u/2^k, s <- s*2^k and the new u is odd
   * returns k
   * (the implementation shifts u >> k and s << k at once if k < w, and shifts by whole words until k < w)
   *
   * in the inversion algorithm it's guaranteed that s << k will remain < p,
   * so everything holds modulo p
   */
  const makeOdd = func(
    {
      in: [{ u: i32 }, { s: i32 }],
      locals: { k: i64, k0: i32, l: i64, tmp: i64 },
      out: [i32],
    },
    ({ u, s }, { k, k0, l, tmp }) => {
      // k = count_trailing_zeros(u[0])
      let ui = Field.loadLimb(u, 0);
      local.tee(k, i64.ctz(ui));
      i64.eqz();
      // if (k === 0) return; (the most common case)
      if_(null, () => {
        i32.const(0);
        return_();
      });
      // while k === 64 (i.e., u[0] === 0), shift by whole words
      // (note: u is not supposed to be 0, so u[0] = 0 implies that u is divisible by 2^w)
      block(null, (block) => {
        loop(null, (loop) => {
          i64.ne(k, 64n);
          br_if(block);

          // copy u[1],...,u[n-1] --> u[0],...,u[n-2]
          local.get(u);
          i32.add(u, 4);
          i32.const((n - 1) * 4);
          memory.copy();

          // u[n-1] = 0
          Field.storeLimb(u, n - 1, 0n);

          // copy s[0],...,s[n-2] --> s[1],...,s[n-1]
          i32.add(s, 4);
          local.get(s);
          i32.const((n - 1) * 4);
          memory.copy();

          // s[0] = 0
          Field.storeLimb(s, 0, 0n);

          local.set(k0, i32.add(k0, Field.w));
          local.set(k, i64.ctz(Field.loadLimb(u, 0)));
          br(loop);
        });
      });

      // here we know that k \in 0,...,w-1
      // l = w - k
      local.set(l, i64.sub(Field.wn, k));

      // u >> k

      // for (let i = 0; i < n-1; i++) {
      //   u[i] = (u[i] >> k) | ((u[i + 1] << l) & wordMax);
      // }
      // u[n-1] = u[n-1] >> k;
      local.set(tmp, Field.loadLimb(u, 0));
      Field.forEach((i) => {
        i64.shr_u(tmp, k);
        if (i < n - 1) {
          local.tee(tmp, Field.loadLimb(u, i + 1));
          i64.shl($, l);
          i64.and($, Field.wordMax);
          i64.or();
        }
        Field.storeLimb(u, i, $);
      });

      // s << k

      // for (let i = n-1; i >= 0; i--) {
      //   s[i+1] = (s[i] >> l) | ((s[i+1] << k) & wordMax);
      // }
      // s[0] = (s[0] << k) & wordMax;
      local.set(tmp, Field.loadLimb(s, n - 1));
      for (let i = n - 2; i >= 0; i--) {
        i64.shl(tmp, k);
        i64.and($, Field.wordMax);
        local.tee(tmp, Field.loadLimb(s, i));
        i64.shr_u($, l);
        i64.or();
        Field.storeLimb(s, i + 1, $);
      }
      i64.shl(tmp, k);
      i64.and($, Field.wordMax);
      Field.storeLimb(s, 0, $);

      // return k
      i32.add(k0, i32.wrap_i64(k));
    }
  );

  // kaliski "almost inverse" algorithm
  // this is modified from the algorithms in papers in that it
  // * returns k-1 instead of k
  // * returns r < p unconditionally
  // * allows to batch left- / right-shifts
  const almostInverse = func(
    {
      in: [{ u: i32 }, { r: i32 }, { a: i32 }],
      locals: { v: i32, s: i32, k: i32 },
      out: [i32],
    },
    ({ u, r, a }, { v, s, k }) => {
      // setup locals
      local.set(v, i32.add(u, Field.size));
      local.set(s, i32.add(v, Field.size));

      // u = p, v = a, r = 0, s = 1
      Field.i32.store(u, Field.i32.P);
      Field.copyInline(v, a);
      Field.i32.store(r, Field.i32.Zero);
      Field.i32.store(s, Field.i32.One);

      // main algorithm
      call(makeOdd, { u, s });
      call(makeOdd, { u: v, s: r });
      local.set(k, i32.add());

      block(null, (block) => {
        loop(null, (loop) => {
          call(Field.isGreater, { x: u, y: v });
          if_(
            null,
            () => {
              call(Field.subtractNoReduce, { out: u, x: u, y: v });
              call(Field.addNoReduce, { out: r, x: r, y: s });
              call(makeOdd, { u, s });
              local.set(k, i32.add($, k));
            },
            () => {
              call(Field.subtractNoReduce, { out: v, x: v, y: u });
              call(Field.addNoReduce, { out: s, x: s, y: r });
              call(Field.isZero, { x: v });
              br_if(block);
              call(makeOdd, { u: v, s: r });
              local.set(k, i32.add($, k));
            }
          );
          br(loop);
        });
      });
      local.get(k);
    }
  );

  // constants we store as global pointers
  let K = n * w;
  let N = log2(p);
  let R2corr = mod(1n << BigInt(4 * K - 2 * N + 1), p);
  let r2corrGlobal = implicitMemory.data(Field.bigintToData(R2corr));
  let pGlobal = implicitMemory.data(Field.bigintToData(p));

  /**
   * montgomery inverse, a 2^K -> a^(-1) 2^K (mod p)
   */
  const inverse = func(
    {
      in: [{ scratch: i32 }, { r: i32 }, { a: i32 }],
      locals: { k: i32 },
      out: [],
    },
    ({ scratch, r, a }, { k }) => {
      // TODO adapt this when we use larger p factor
      call(Field.reduce, { x: a });

      // error if input is zero
      call(Field.isZero, { x: a });
      if_(null, () => unreachable());

      call(almostInverse, { u: scratch, r, a });
      local.set(k);
      // don't have to reduce r here, because it's already < p
      call(Field.subtractNoReduce, { out: r, x: pGlobal, y: r });
      // multiply by 2^(2N - k), where N = 381 = bit length of p
      // TODO: efficient multiplication by power-of-2?
      // we use k+1 here because that's the value the theory is about:
      // N <= k+1 <= 2N, so that 0 <= 2N-(k+1) <= N, so that
      // 1 <= 2^(2N-(k+1)) <= 2^N < 2p
      // (in practice, k seems to be normally distributed around ~1.4N and never reach either N or 2N)
      call(Field.leftShift, { xy: r, y: r, k: i32.sub(2 * N - 1, k) }); // * 2^(2N - (k+1)) * 2^(-K)
      // now we multiply by 2^(2(K + K-N) + 1))
      call(Field.multiply, { xy: r, x: r, y: r2corrGlobal }); // * 2^(2K + 2(K-n) + 1) * 2^(-K)
      // = * 2 ^ (2n - k - 1 + 2(K-n) + 1)) = 2^(2*K - k)
      // ^^^ transforms (a * 2^K)^(-1)*2^k = a^(-1) 2^(-K+k)
      //     to a^(-1) 2^(-K+k + 2K -k) = a^(-1) 2^K = the montgomery representation of a^(-1)
    }
  );

  const batchInverse = func(
    {
      in: [{ scratch: i32 }, { z: i32 }, { x: i32 }, { $n: i32 }],
      locals: { $i: i32, I: i32, $N: i32 },
      out: [],
    },
    ({ scratch, z, x, $n }, { $i, I, $N }) => {
      local.set(I, scratch);
      local.set(scratch, i32.add(scratch, Field.size));
      local.set($N, i32.mul($n, Field.size));
      // return early if n = 0 or 1
      i32.eqz($n);
      if_(null, () => return_());
      i32.eq($n, 1);
      if_(null, () => {
        call(inverse, { scratch, r: z, a: x });
        return_();
      });
      // create products x0*x1, ..., x0*...*x(n-1)
      call(multiply, {
        xy: i32.add(z, Field.size),
        x: i32.add(x, Field.size),
        y: x,
      });
      i32.eq($n, 2);
      if_(null, () => {
        call(inverse, { scratch, r: I, a: i32.add(z, Field.size) });
        call(multiply, { xy: i32.add(z, Field.size), x, y: I }),
          call(multiply, { xy: z, x: i32.add(x, Field.size), y: I }),
          return_();
      });
      local.set($i, i32.const(2 * Field.size));
      loop(null, () => {
        call(multiply, {
          xy: i32.add(z, $i),
          x: i32.add(z, i32.sub($i, Field.size)),
          y: i32.add(x, $i),
        });
        i32.ne($N, local.tee($i, i32.add($i, Field.size)));
        br_if(0);
      });
      // inverse I = 1/(x0*...*x(n-1))
      call(inverse, { scratch, r: I, a: i32.add(z, i32.sub($N, Field.size)) });
      // create inverses 1/x(n-1), ..., 1/x2
      local.set($i, i32.sub($N, Field.size));
      loop(null, () => {
        call(multiply, {
          xy: i32.add(z, $i),
          x: i32.add(z, i32.sub($i, Field.size)),
          y: I,
        });
        call(multiply, { xy: I, x: I, y: i32.add(x, $i) });
        i32.ne(Field.size, local.tee($i, i32.sub($i, Field.size)));
        br_if(0);
      });
      // 1/x1, 1/x0
      call(multiply, { xy: i32.add(z, Field.size), x, y: I });
      call(multiply, { xy: z, x: i32.add(x, Field.size), y: I });
    }
  );

  return { makeOdd, inverse, batchInverse };
}
