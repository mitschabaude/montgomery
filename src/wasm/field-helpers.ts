import type * as W from "wasmati";
import {
  $,
  control,
  func,
  i32,
  i64,
  local,
  Local,
  StackVar,
  Input,
  importFunc,
  Type,
  call,
} from "wasmati";
import {
  assert,
  bigintFromLimbs,
  bigintToBytes,
  bigintToLimbs as bigintToLimbs_,
} from "../util.js";
import { montgomeryParams } from "../bigint/field-util.js";

export { createField, Field };
export { fromPackedBytes, toPackedBytes, extractBitSlice };

// inline methods to operate on a field element stored as n * w-bit limbs

type Field = ReturnType<typeof createField>;

function createField(p: bigint, w: number) {
  const { n, wn, wordMax, R } = montgomeryParams(p, w);
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

  // TODO wasmati optimizes for TS tuples, should be easier to work with TS arrays
  let limbsType: Tuple<Type<i64>> = [i64, ...Array(n - 1).fill(i64)];

  let logLocalsImport = importFunc(
    { in: limbsType, out: [] },
    (...limbs: bigint[]) => {
      let x = bigintFromLimbs(limbs, w, n);
      console.log("logging from wasm (limbs)", limbs);
      console.log("logging from wasm", x);
    }
  );

  function logLocals(X: Local<i64>[]) {
    call(logLocalsImport, X as Tuple<Local<i64>>);
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

// helpers to convert between internal format and I/O-friendly, packed byte format
// method: just pack all the n*w bits into memory contiguously

/**
 * recover n * w-bit representation (1 int32 per w-bit limb) from packed representation
 */
function fromPackedBytes(w: number, n: number) {
  let wn = BigInt(w);
  let wordMax = (1n << wn) - 1n;

  if (w > 32) throw Error(`fromPackedBytes assumes that w <= 32, got w = ${w}`);

  // recover n*w-bit representation (1 int32 per w-bit limb) from packed byte representation
  return func(
    { in: [i32, i32], locals: [i64, i64], out: [] },
    ([x, bytes], [tmp, chunk]) => {
      let offset = 0; // bytes offset
      let nRes = 0n; // residual bits read in the last iteration

      // read bytes word by word
      for (let i = 0; i < n; i++) {
        // if we can't fill up w bits with the current residual, load a full i64 from bytes
        // (some of that i64 could be garbage, but we'll only use the parts that aren't)
        if (nRes < w) {
          // tmp = (bytes << nRes) | tmp
          i64.shl(
            // load 8 bytes at current offset
            // due to the left shift, we lose nRes of them
            local.tee(chunk, i64.load({ offset }, bytes)),
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
    { in: [i32, i32], locals: [i64], out: [] },
    ([bytes, x], [tmp]) => {
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
    { in: [i32, i32, i32], locals: [i32, i32, i32], out: [i32] },
    ([x, startBit, bitLength], [endBit, startLimb, endLimb]) => {
      local.set(endBit, i32.add(startBit, bitLength));
      local.set(startLimb, i32.div_u(startBit, w));
      local.set(startBit, i32.sub(local.get(startBit), i32.mul(startLimb, w)));
      local.set(endLimb, i32.div_u(endBit, w));
      local.set(endBit, i32.sub(local.get(endBit), i32.mul(endLimb, w)));
      // check for overflow of endLimb
      i32.gt_u(endLimb, n - 1);

      control.if({}, () => {
        // in that case, truncate endBit = w and endLimb = startLimb = n-1
        local.set(endBit, w);
        local.set(endLimb, n - 1);
      });
      i32.eq(startLimb, endLimb);
      control.if({}, () => {
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

type Tuple<T> = [T, ...T[]];
