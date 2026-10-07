import type * as W from "wasmati";
import {
  $,
  control,
  func,
  i32,
  i64,
  local,
  type Local,
  StackVar,
  type Input,
  importFunc,
  type Type,
  call,
  select,
  type Func,
} from "wasmati";
import { forLoop1 } from "./wasm-util.ts";
import {
  assert,
  bigintFromLimbs,
  bigintToBytes,
  bigintToLimbs as bigintToLimbs_,
} from "../util.ts";

export { createField, type Field };
export { fromPackedBytes, toPackedBytes, extractBitSlice, decomposeAndSlice };

// inline methods to operate on a field element stored as n * w-bit limbs

type Field = ReturnType<typeof createField>;

function createField(p: bigint, w: number, n: number) {
  let wn = BigInt(w);
  let wordMax = (1n << wn) - 1n;
  let R = 1n << (BigInt(n) * wn);
  const size = 4 * n; // size in bytes

  function loadLimb(x: Local<i32>, i: number) {
    assert(i >= 0, "positive index");
    return i64.extend_i32_u(i32.load({ offset: 4 * i }, x));
  }
  function loadLimb32(x: Local<i32>, i: number) {
    assert(i >= 0, "positive index");
    return i32.load({ offset: 4 * i }, x);
  }
  function storeLimb(x: Local<i32>, i: number, xi: Input<i64>) {
    assert(i >= 0, "positive index");
    i32.store({ offset: 4 * i }, x, i32.wrap_i64(xi));
  }
  function storeLimb32(x: Local<i32>, i: number, xi: Input<i32>) {
    assert(i >= 0, "positive index");
    i32.store({ offset: 4 * i }, x, xi);
  }

  function bigintToLimbs(x: bigint) {
    return bigintToLimbs_(x, w, n);
  }
  function bigintToLimbs32(x: bigint) {
    return bigintToLimbs_(x, w, n).map(Number);
  }

  function bigintToData(x: bigint) {
    return bigintToLimbs(x).flatMap((xi) => [...bigintToBytes(xi, 4)]);
  }

  function forEach(callback: (i: number) => void) {
    for (let i = 0; i < n; i++) {
      callback(i);
    }
  }
  function forEachReversed(callback: (i: number) => void) {
    for (let i = n - 1; i >= 0; i--) {
      callback(i);
    }
  }

  function load(x: Local<i32>, X: Local<i64>[]) {
    for (let i = 0; i < n; i++) {
      i32.load({ offset: i * 4 }, x);
      i64.extend_i32_u();
      local.set(X[i]);
    }
  }
  function load32(x: Local<i32>, X: Local<i32>[]) {
    for (let i = 0; i < n; i++) {
      local.set(X[i], i32.load({ offset: i * 4 }, x));
    }
  }

  function store(x: Local<i32>, X: Input<i64>[]) {
    for (let j = 0; j < n; j++) {
      i32.store({ offset: 4 * j }, x, i32.wrap_i64(X[j]));
    }
  }
  function store32(x: Local<i32>, X: Input<i32>[]) {
    for (let j = 0; j < n; j++) {
      i32.store({ offset: 4 * j }, x, X[j]);
    }
  }

  function carryAndStore(x: Local<i32>, X: Local<i64>[]) {
    for (let j = 1; j < n; j++) {
      i32.wrap_i64(i64.and(X[j - 1], wordMax));
      i32.store({ offset: 4 * (j - 1) }, x, $);
      i64.shr_u(X[j - 1], wn);
      local.set(X[j], i64.add($, X[j]));
    }
    i32.wrap_i64(X[n - 1]);
    i32.store({ offset: 4 * (n - 1) }, x, $);
  }

  const limbNames = Array.from({ length: n }, (_, i) => `limb${i}`);
  const limbsType: Record<string, typeof i64>[] = limbNames.map((name) => ({
    [name]: i64,
  }));

  let logLocalsImport = importFunc(
    { in: limbsType, out: [] },
    (...limbs: bigint[]) => {
      let x = bigintFromLimbs(limbs, w, n);
      console.log("logging from wasm (limbs)", limbs);
      console.log("logging from wasm", x);
    }
  );

  function logLocals(X: Local<i64>[]) {
    call(
      logLocalsImport,
      Object.fromEntries(limbNames.map((name, i) => [name, X[i]]))
    );
  }

  /**
   * optionally perform carry()
   */
  function optionalCarry(
    shouldCarry: boolean,
    input: StackVar<i64>,
    tmp: Local<i64>
  ) {
    if (shouldCarry) carry(input, tmp);
  }

  /**
   * perform a w-bit carry on a 64-bit value and put both the low and high parts on the stack (low first).
   *
   * needs a tmp local var since the input is on the current stack
   */
  function carry(input: StackVar<i64>, tmp: Local<i64>) {
    // put carry on the stack
    local.tee(tmp, input);
    i64.shr_u($, wn);
    // mod 2^w the current result
    i64.and(tmp, wordMax);
  }
  /**
   * same as {@link carry} but with a signed shift, suitable for carrying values in the range
   * [-2^63, 2^63)
   */
  function carrySigned(input: StackVar<i64>, tmp: Local<i64>) {
    // put carry on the stack
    local.tee(tmp, input);
    i64.shr_s($, wn);
    // mod 2^w the current result
    i64.and(tmp, wordMax);
  }

  function optionalCarryAdd(didCarry: boolean) {
    // add carry from stack
    if (didCarry) i64.add();
  }

  let P = bigintToLimbs(p);
  let P2 = bigintToLimbs(2n * p);

  return {
    p,
    w,
    n,
    wn,
    wordMax,
    R,
    P,
    P2,
    size,
    loadLimb,
    storeLimb,
    bigintToLimbs,
    bigintToData,
    carry,
    carrySigned,
    forEach,
    forEachReversed,
    load,
    store,
    carryAndStore,
    optionalCarry,
    optionalCarryAdd,
    logLocals,
    i32: {
      loadLimb: loadLimb32,
      storeLimb: storeLimb32,
      bigintToLimbs: bigintToLimbs32,
      load: load32,
      store: store32,
      P: P.map(Number),
      One: bigintToLimbs32(1n),
      Zero: bigintToLimbs32(0n),
    },
  };
}

// helpers to convert between internal format and I/O-friendly, packed byte format with `nPackBytes` bytes

/**
 * recover n * w-bit representation (1 int32 per w-bit limb) from packed representation
 */
function fromPackedBytes(w: number, n: number, nPackedBytes: number) {
  let wn = BigInt(w);
  let wordMax = (1n << wn) - 1n;

  if (w > 32) throw Error(`fromPackedBytes assumes that w <= 32, got w = ${w}`);

  // recover n*w-bit representation (1 int32 per w-bit limb) from packed byte representation
  return func(
    {
      in: [{ x: i32 }, { bytes: i32 }],
      locals: { tmp: i64, chunk: i64 },
      out: [],
    },
    ({ x, bytes }, { tmp, chunk }) => {
      let offset = 0; // bytes offset
      let nRes = 0n; // residual bits read in the last iteration
      let nRead = 0; // bytes read

      // read bytes word by word
      for (let i = 0; i < n; i++) {
        // if we can't fill up w bits with the current residual, load a full i64 from bytes
        // (some of that i64 could be garbage, but we'll only use the parts that aren't)
        if (nRes < w) {
          // tmp = (bytes << nRes) | tmp
          i64.load({ offset }, bytes);
          if (nRead + 8 > nPackedBytes) {
            // if we're past the input length, we need to mask out the remaining bits
            let mask = (1n << BigInt((nPackedBytes - nRead) * 8)) - 1n;
            i64.and($, mask);
          }
          nRead = Math.min(nRead + 8, nPackedBytes);
          i64.shl(
            // load 8 bytes at current offset
            // due to the left shift, we lose nRes of them
            local.tee(chunk, $),
            nRes
          );
          local.set(tmp, i64.or($, tmp));

          // store what fits in next word
          local.get(x);
          i32.wrap_i64(i64.and(tmp, wordMax));
          i32.store({ offset: 4 * i });

          // keep residual bits for next iteration
          local.set(tmp, i64.shr_u(chunk, wn - nRes));
          offset += 8;
          nRes = nRes - wn + 64n;
        } else {
          // otherwise, the current tmp is just what we want!
          local.get(x);
          i32.wrap_i64(i64.and(tmp, wordMax));
          i32.store({ offset: 4 * i });
          local.set(tmp, i64.shr_u(tmp, wn));
          nRes = nRes - wn;
        }
      }
    }
  );
}

/**
 * converts n * w-bit representation (1 int32 per w-bit limb) to packed `nPackedBytes`-byte representation
 */
function toPackedBytes(w: number, n: number, nPackedBytes: number) {
  if (w > 32) throw Error(`toPackedBytes assumes that w <= 32, got w = ${w}`);

  return func(
    { in: [{ bytes: i32 }, { x: i32 }], locals: { tmp: i64 }, out: [] },
    ({ bytes, x }, { tmp }) => {
      let offset = 0; // memory offset
      let nRes = 0; // residual bits to write from last iteration

      for (let i = 0; i < n; i++) {
        // how many bytes to write in this iteration
        let nBytes = Math.floor((nRes + w) / 8); // max number of bytes we can get from residual + this word
        let bytesMask = (1n << (8n * BigInt(nBytes))) - 1n;

        // tmp = tmp | (x[i] >> nr)  where nr is the bit length of tmp (nr < 8)
        i64.shl(i64.extend_i32_u(i32.load({ offset: 4 * i }, x)), BigInt(nRes));
        local.set(tmp, i64.or($, tmp));

        // store bytes at current offset
        i64.store({ offset }, local.get(bytes), i64.and(tmp, bytesMask));

        // keep residual bits for next iteration
        local.set(tmp, i64.shr_u(tmp, BigInt(8 * nBytes)));
        offset += nBytes;
        nRes = nRes + w - 8 * nBytes;
      }
      // final round: write residual bits, if there are any
      if (offset < nPackedBytes) i64.store({ offset }, bytes, tmp);
    }
  );
}

// TODO return value should be multi-value!
/**
 * extract `bitLength` bits from field `x`, starting at `startBit`
 */
function extractBitSlice(w: number, n: number) {
  // implicit assumption: we need to touch at most two limbs to extract a bit slice
  // <==> w+1 >= bitLength
  // w+1 is about 30, and c is about log(N)-1, so this assumption is valid until we do MSMs with ~ 2^30 inputs
  // we also assume that the startLimb can not be out of bounds (the caller has to ensure that)

  // these assumptions imply that after truncation of the startBit, we have
  // startBit + bitLength <= w-1 + w+1 <= 2w < 64
  return func(
    {
      in: [{ x: i32 }, { startBit: i32 }, { bitLength: i32 }],
      locals: { endBit: i32, startLimb: i32, endLimb: i32 },
      out: [i32],
    },
    ({ x, startBit, bitLength }, { endBit, startLimb, endLimb }) => {
      local.set(endBit, i32.add(startBit, bitLength));
      local.set(startLimb, i32.div_u(startBit, w));
      local.set(startBit, i32.sub(local.get(startBit), i32.mul(startLimb, w)));
      local.set(endLimb, i32.div_u(endBit, w));
      local.set(endBit, i32.sub(local.get(endBit), i32.mul(endLimb, w)));
      // check for overflow of endLimb
      i32.gt_u(endLimb, n - 1);

      control.if(() => {
        // in that case, truncate endBit = w and endLimb = startLimb = n-1
        local.set(endBit, w);
        local.set(endLimb, n - 1);
      });
      i32.eq(startLimb, endLimb);
      control.if(() => {
        // load scalar limb
        i32.load({}, i32.add(local.get(x), i32.shl(startLimb, 2)));
        // take bits < endBit
        i32.sub(i32.shl(1, endBit), 1);
        i32.and();
        // truncate bits < startBit
        i32.shr_u($, startBit);
        control.return();
      });
      // if we're here, endLimb = startLimb + 1 according to our assumptions
      // load first limb
      i32.load({}, i32.add(local.get(x), i32.shl(startLimb, 2)));
      // truncate bits < startBit (and leave on the stack)
      local.get(startBit);
      i32.shr_u();
      // load second limb,
      i32.load({}, i32.add(local.get(x), i32.shl(i32.add(startLimb, 1), 2)));
      // take bits < endBit
      i32.sub(i32.shl(1, endBit), 1);
      i32.and();
      // stitch together with first half, and return
      i32.shl($, i32.sub(w, startBit));
      i32.or();
    }
  );
}

/**
 * GLV-decomposes n scalars and slices both halves into K signed digits, for
 * windows of c bits for k < kHi and c + 1 bits for k >= kHi.
 *
 * The digit in window k of half scalar h = 2i + j, j = 0, 1, is stored at
 * index k*stride + h of `slices`, as bucket l in 1..2^(c_k - 1) and the sign
 * in the top bit, or 0 for digit 0. The negation flags returned by `decompose`
 * are stored as bytes at `flags`. Takes two scalars of scratch.
 *
 * Assumes that half scalars have n0 limbs of w bits, and windows of at most
 * w + 1 bits.
 */
function decomposeAndSlice(
  decompose: Func<[{ s0: "i32" }, { s1: "i32" }, { s: "i32" }], ["i32"]>,
  w: number,
  n: number,
  n0: number
) {
  let size = 4 * n;
  return func(
    {
      in: [
        { slices: i32 },
        { flags: i32 },
        { scalars: i32 },
        { scratch: i32 },
        { nScalars: i32 },
        { stride: i32 },
        { K: i32 },
        { c: i32 },
        { kHi: i32 },
      ],
      locals: {
        i: i32,
        j: i32,
        k: i32,
        half: i32,
        out: i32,
        start: i32,
        ck: i32,
        limb: i32,
        l: i32,
        L: i32,
        carry: i32,
      },
      out: [],
    },
    (
      { slices, flags, scalars, scratch, nScalars, stride, K, c, kHi },
      { i, j, k, half, out, start, ck, limb, l, L, carry }
    ) => {
      forLoop1(i, 0, nScalars, () => {
        call(decompose, {
          s0: scratch,
          s1: i32.add(scratch, size),
          s: i32.add(scalars, i32.mul(i, size)),
        });
        local.set(l, $);
        i32.store8({}, i32.add(flags, i), l);
        forLoop1(j, 0, 2, () => {
          local.set(half, i32.add(scratch, i32.mul(j, size)));
          // index 2i + j of window 0
          local.set(
            out,
            i32.add(slices, i32.shl(i32.add(i32.shl(i, 1), j), 2))
          );
          local.set(start, 0);
          local.set(carry, 0);
          forLoop1(k, 0, K, () => {
            local.set(ck, i32.add(c, i32.ge_u(k, kHi)));
            local.set(limb, i32.div_u(start, w));
            // the window's bits, from at most two limbs
            i64.load32_u({}, i32.add(half, i32.shl(limb, 2)));
            i64.load32_u({ offset: 4 }, i32.add(half, i32.shl(limb, 2)));
            i64.shl($, BigInt(w));
            i64.const(0n);
            i32.lt_u(i32.add(limb, 1), n0);
            select(i64);
            i64.or();
            i64.shr_u($, i64.extend_i32_u(i32.sub(start, i32.mul(limb, w))));
            i32.wrap_i64($);
            i32.and($, i32.sub(i32.shl(1, ck), 1));
            local.set(l, i32.add($, carry));
            // signed digit: if l > L, use 2L - l and carry 1
            local.set(L, i32.shl(1, i32.sub(ck, 1)));
            local.set(carry, i32.gt_u(l, L));
            i32.sub(i32.shl(L, 1), l);
            local.get(l);
            local.get(carry);
            select(i32);
            local.set(l, $);
            i32.or(l, i32.shl(carry, 31));
            i32.const(0);
            local.get(l);
            select(i32);
            local.set(l, $);
            i32.store({}, out, l);
            local.set(out, i32.add(out, i32.shl(stride, 2)));
            local.set(start, i32.add(start, ck));
          });
        });
      });
    }
  );
}
