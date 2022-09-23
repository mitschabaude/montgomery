import { bigintToBits, bigintToLegs, log2 } from "./util.js";
import { mod, modInverse, randomBaseFieldx2 } from "./finite-field-js.js";
import {
  addExport,
  addFuncExport,
  block,
  forLoop1,
  forLoop8,
  func,
  if_,
  loop,
  module,
  ops,
  Writer,
} from "./wasm-generate.js";

// main API
export { createFiniteField, createFiniteFieldWat, jsHelpers, montgomeryParams };

// for w=32 benchmark
export { benchMultiply, multiply32, moduleWithMemory };

/**
 * TODOs
 *
 * -) evaluate when reducing in addition / subtraction can be left out,
 *   => can accept upper bounds > 2p on multiplication inputs
 * -) test whether add2 is faster than add in the real world case
 */

/**
 * @typedef {ReturnType<typeof createFiniteField> extends Promise<infer T> ? T : never} FiniteField
 */

/**
 * Creates arithmetic functions built on top of Wasm, for any p & w
 *
 * @param {bigint} p
 * @param {number} w
 * @param {import('./finite-field.wat')} wasm
 */
async function createFiniteField(p, w, wasm) {
  let {
    multiply,
    add,
    addNoReduce,
    subtractNoReduce,
    reduce,
    isZero,
    isGreater,
    makeOdd,
    copy,
    isEqual,
    shiftTogether1,
  } = wasm;
  let helpers = jsHelpers(p, w, wasm);
  let { readBigInt, writeBigint, getPointers, getStablePointers } = helpers;

  // put some constants in wasm memory
  let { K, R } = montgomeryParams(p, w);
  let N = log2(p);

  let constantsBigint = {
    zero: 0n,
    one: 1n,
    p,
    R: mod(R, p),
    R2: mod(R * R, p),
    R2corr: mod(1n << BigInt(4 * K - 2 * N + 1), p),
    // common numbers in montgomery representation
    mg1: mod(1n * R, p),
    mg2: mod(2n * R, p),
    mg4: mod(4n * R, p),
    mg8: mod(8n * R, p),
  };
  let constantsKeys = Object.keys(constantsBigint);
  let constantsPointers = getStablePointers(constantsKeys.length);

  /**
   * @type {Record<keyof typeof constantsBigint, number>}
   */
  let constants = Object.fromEntries(
    constantsKeys.map((key, i) => {
      let pointer = constantsPointers[i];
      writeBigint(pointer, constantsBigint[key]);
      return [key, pointer];
    })
  );

  let pPlus1Div4 = bigintToBits((p + 1n) / 4n, 381);
  let numberOfInversions = 0;

  /**
   * montgomery inverse, a 2^K -> a^(-1) 2^K (mod p)
   *
   * @param {number[]} scratch
   * @param {number} r
   * @param {number} a
   */
  function inverse(scratch, r, a) {
    if (isZero(a)) throw Error("cannot invert 0");
    numberOfInversions++;
    reduce(a);
    let k = almostInverseMontgomery(scratch, r, a);
    // TODO: negation -- special case which is simpler
    // don't have to reduce r here, because it's already < p
    subtractNoReduce(r, constants.p, r);

    // mutliply by 2^(2N - k), where N = 381 = bit length of p
    // TODO: efficient multiplication by power-of-2?
    // we use k+1 here because that's the value the theory is about:
    // n <= k+1 <= 2N, so that 0 <= 2N-(k+1) <= N, so that
    // 1 <= 2^(2N-(k+1)) <= 2^N < 2p
    // (in practice, k seems to be normally distributed around ~1.4N and never reach either N or 2N)
    let l = BigInt(2 * N - (k + 1));
    let [twoL] = scratch;
    writeBigint(twoL, 1n << l);
    multiply(r, r, twoL); // * 2^(2N - (k+1)) * 2^(-K)

    // now we multiply by 2^(2(K + K-N) + 1))
    multiply(r, r, constants.R2corr); // * 2^(2K + 2(K-n) + 1) * 2^(-K)
    // = * 2 ^ (2n - k - 1 + 2(K-n) + 1)) = 2^(2*K - k)
    // ^^^ transforms (a * 2^K)^(-1)*2^k = a^(-1) 2^(-K+k)
    //     to a^(-1) 2^(-K+k + 2K -k) = a^(-1) 2^K = the montgomery representation of a^(-1)
  }

  // this is modified from the algorithms in papers in that it
  // * returns k-1 instead of k
  // * returns r < p without unconditionally
  // * allows to batch left- / right-shifts
  /**
   *
   * @param {number[]} scratch
   * @param {number} r
   * @param {number} a
   * @returns
   */
  function almostInverseMontgomery([u, v, s], r, a) {
    // u = p, v = a, r = 0, s = 1
    copy(u, constants.p);
    copy(v, a);
    copy(r, constants.zero);
    copy(s, constants.one);
    let k = 0;
    k += makeOdd(u, s);
    k += makeOdd(v, r);
    while (true) {
      if (isGreater(u, v)) {
        subtractNoReduce(u, u, v);
        addNoReduce(r, r, s);
        k += makeOdd(u, s);
      } else {
        subtractNoReduce(v, v, u);
        addNoReduce(s, r, s);
        if (isZero(v)) break;
        k += makeOdd(v, r);
      }
    }
    // TODO: this works without r << 1 at the end because k is also not incremented
    // so the invariant a*r = 2^k (mod p) is still true with a factor 2 less on both sides
    return k;
  }

  // TODO
  function square(z, x) {
    multiply(z, x, x);
  }
  /**
   * sqrt(x)
   *
   * @param {number[]} scratch
   * @param {number} root
   * @param {number} x
   * @returns boolean indicating whether taking the root was successful
   */
  function sqrt([tmp], root, x) {
    pow([tmp], root, x, pPlus1Div4);
    multiply(tmp, root, root);
    reduce(tmp);
    reduce(x);
    if (!isEqual(tmp, x)) return false;
    return true;
  }
  /**
   * montgomery modular exponentiation, a^n
   *
   * @param {number[]} scratch
   * @param {number} x a^n
   * @param {number} a
   * @param {boolean[]} nBits bits of n
   */
  function pow([a], x, a0, nBits) {
    copy(x, constants.mg1);
    copy(a, a0);
    for (let bit of nBits) {
      if (bit) multiply(x, x, a);
      multiply(a, a, a);
    }
  }

  /**
   * benchmark inverse, by doing N*(inv + add)
   * (add is negligible; done re-randomize to avoid unrealistic compiler optimizations)
   * @param {number} N
   */
  function benchInverse(N) {
    let scratch = getPointers(10);
    let [x, y] = getPointers(2);
    let x0 = randomBaseFieldx2();
    let y0 = randomBaseFieldx2();
    writeBigint(x, x0);
    writeBigint(y, y0);
    for (let i = 0; i < N; i++) {
      // x <- x + y
      // y <- 1/x
      inverse(scratch, y, x);
      add(x, x, y);
    }
  }

  return {
    ...wasm,
    ...helpers,
    constants,
    /**
     * montgomery inverse, a 2^K -> a^(-1) 2^K (mod p)
     */
    inverse,
    square,
    /**
     * montgomery modular exponentiation, a^n
     */
    pow,
    /**
     * sqrt(x)
     */
    sqrt,
    benchInverse,
    getInversions() {
      return numberOfInversions;
    },
    getAndResetOpCounts() {
      let nMul = wasm.multiplyCount.valueOf();
      let nInv = numberOfInversions;
      wasm.resetMultiplyCount();
      numberOfInversions = 0;
      return [nMul, nInv];
    },
  };
}

/**
 *
 * @param {bigint} p
 * @param {number} w
 */
async function createFiniteFieldWat(p, w, { withBenchmarks = false } = {}) {
  let { n } = montgomeryParams(p, w);
  let writer = Writer();
  moduleWithMemory(
    writer,
    `generated for w=${w}, n=${n}, n*w=${n * w}`,
    65536,
    () => {
      multiply(writer, p, w, { countMultiplications: !!withBenchmarks });

      add(writer, p, w);
      subtract(writer, p, w);

      reduce(writer, p, w);
      makeOdd(writer, p, w);
      finiteFieldHelpers(writer, p, w);

      if (withBenchmarks) {
        benchMultiply(writer);
        benchAdd(writer);
        benchSubtract(writer);
      }
    }
  );
  return writer;
}

/**
 * montgomery product
 *
 * ideas of the algorithm:
 *
 * - we compute x*y*2^(-n*w) mod p
 * - x, y and p are represented as arrays of size n, with w-bit legs/digits, each stored as int64
 * - in math, x = Sum_i=0...(n-1)( x_i*2^(i*w) ), where x_i \in [0,2^w)
 * - w <= 32 so that we can just multiply two elements x_i*y_j as int64
 * - important: be flexible w.r.t. w; the literature says w=32, but that's not ideal here
 *
 * to compute x*y*2^(-n*w) mod p, we expand x = Sum_i( x_i*2^(i*w) ), so we get
 *   S := x*y*2^(-n*w) = Sum_i( x_i*y*2^(i*w) ) * 2^(-n*w) =
 *      = Sum_i( x_i*y*2^(-(n-i)*w) ) mod p
 * this sum mod p can be computed iteratively:
 * - initialize S = 0
 * - for i=0,...,n-1 : S = (S + x_i*y) * 2^(-w) mod p
 * - note: earlier terms in the sum get multiplied by more 2^(-w) factors!
 * in each step, compute (S + x_i*y) * 2^(-w) mod p by doing the montgomery reduction trick:
 * add a multiple of p which makes the result divisible by 2^w, so *2^(-w) becomes a normal division!
 *
 * so in each step we want (S + x_i*y + q_i*p) * 2^(-w), where q_i is such that S + x_i*y + q_i*p = 0 mod 2^w
 * that's true if q_i = (-p)^(-1) * (S + x_i*y) mod 2^w
 * since the equality is mod 2^w, we can take all the parts mod 2^w -- which means taking the lowest word of S and y!
 * ==> q_i = mu * (S_0 + x_i*y_0) mod 2^w, where mu = (-p)^(-1) mod 2^w is precomputed, and is a single word
 * (of this expression, S_0 + x_i*y_0 needs to be computed anyway as part of S + x_i*y + q_i*p)
 *
 * in detail, S + x_i*y + q_i*p is computed by computing up terms like
 *   S_j + x_i*y_j + q_i*p_j
 * and, when needed, carrying over to the next term. which means the term we compute are more like
 *   carry_(j-1) + S_j + x_i*y_j + q_i*p_j
 *
 * multiplying by 2^(-w) just means shifting the array S_0,...,S_(n-1) by one term, so that e.g. (S_1 + ...) becomes S_0
 * so we get something like
 *   (carry_0, _) = S_0 + x_i*y_0 + q_i*p_0
 *   (carry_j, S_(j-1)) = carry_(j-1) + S_j + x_i*y_j + q_i*p_j    for j=1,...,(n-1)
 *   S_(n-1) = carry_(n-1)
 *
 * this is the gist, but in fact the number of carry operations depends on the bit length w
 * the w=32 case needs more carry operations than shown above, since x_i*y_j + q_i*p_j would have 65 bits already
 * on the other hand, w<32 doesn't need a carry in every j step
 * so, by making w < 32, we get more S_j + x_i*y_j + q_i*p_j terms, but (much) less carries
 */
function multiply(writer, p, w, { countMultiplications = false } = {}) {
  let { n, wn, wordMax } = montgomeryParams(p, w);
  // constants
  let mu = modInverse(-p, 1n << wn);
  let P = bigintToLegs(p, w, n);
  // how much terms we can add before a carry
  let nSafeTerms = 64 - 2 * w + 1;
  // how much j steps we can do before a carry:
  let nSafeSteps = 32 - w;
  // strategy is to use a carry at j=0, plus whenever we reach nSafeSteps
  // (and finally at the end)
  // how many carry variables we need
  let nCarry = 1 + Math.floor(n / nSafeSteps);

  let { line, lines, comment, join } = writer;
  let { i64, i32, local, local32, local64, param32, global32Mut, global } = ops;

  // count multiplications to analyze higher-level algorithms
  let multiplyCount = "$multiplyCount";
  if (countMultiplications) {
    addExport(writer, "multiplyCount", global(multiplyCount));
    addFuncExport(writer, "resetMultiplyCount");
    line(global32Mut(multiplyCount, 0));
    func(writer, "resetMultiplyCount", [], () => {
      line(global.set(multiplyCount, i32.const(0)));
    });
  }

  addFuncExport(writer, "multiply");

  let [x, y, xy] = ["$x", "$y", "$xy"];
  func(writer, "multiply", [param32(xy), param32(x), param32(y)], () => {
    let [tmp] = ["$tmp"];
    let [i, xi, qi] = ["$i", "$xi", "$qi"];

    // locals
    line(local64(tmp));
    line(local64(qi), local64(xi), local32(i));
    let Y = defineLocals(writer, "y", n);
    let S = defineLocals(writer, "t", n);

    if (countMultiplications) {
      line(global.set(multiplyCount, i32.add(global.get(multiplyCount), 1)));
    }

    // load y
    for (let i = 0; i < n; i++) {
      line(local.set(Y[i], i64.load(local.get(y), { offset: i * 8 })));
    }

    forLoop8(writer, i, 0, n, () => {
      // load x[i]
      line(local.set(xi, i64.load(i32.add(x, i))));

      // j=0, compute q_i
      let didCarry = false;
      let doCarry = 0 % nSafeSteps === 0;
      comment("j = 0, do carry, ignore result below carry");
      lines(
        // tmp = S[0] + x[i]*y[0]
        local.get(S[0]),
        i64.mul(xi, Y[0]),
        i64.add(),
        // qi = mu * (tmp & wordMax) & wordMax
        local.set(tmp),
        local.set(qi, i64.and(i64.mul(mu, i64.and(tmp, wordMax)), wordMax)),
        local.get(tmp),
        // (stack, _) = tmp + qi*p[0]
        i64.mul(qi, P[0]),
        i64.add(),
        join(i64.const(w), i64.shr_u()) // we just put carry on the stack, use it later
      );

      for (let j = 1; j < n - 1; j++) {
        // S[j] + x[i]*y[j] + qi*p[j], or
        // stack + S[j] + x[i]*y[j] + qi*p[j]
        // ... = S[j-1], or  = (stack, S[j-1])
        didCarry = doCarry;
        doCarry = j % nSafeSteps === 0;
        comment(`j = ${j}${doCarry ? ", do carry" : ""}`);
        lines(
          local.get(S[j]),
          didCarry && i64.add(), // add carry from stack
          i64.mul(xi, Y[j]),
          i64.add(),
          i64.mul(qi, P[j]),
          i64.add(),
          doCarry && join(local.tee(tmp), i64.const(w), i64.shr_u()), // put carry on the stack
          doCarry && i64.and(tmp, wordMax), // mod 2^w the current result
          local.set(S[j - 1])
        );
      }
      let j = n - 1;
      didCarry = doCarry;
      doCarry = j % nSafeSteps === 0;
      comment(`j = ${j}${doCarry ? ", do carry" : ""}`);
      if (doCarry) {
        lines(
          local.get(S[j]),
          didCarry && i64.add(), // add carry from stack
          i64.mul(xi, Y[j]),
          i64.add(),
          i64.mul(qi, P[j]),
          i64.add(),
          doCarry && join(local.tee(tmp), i64.const(w), i64.shr_u()), // put carry on the stack
          doCarry && i64.and(tmp, wordMax), // mod 2^w the current result
          local.set(S[j - 1])
        );
        // if the last iteration does a carry, S[n-1] is set to it
        lines(local.set(S[j]));
      } else {
        // if the last iteration doesn't do a carry, then S[n-1] is never set,
        // so we also don't have to get it & can save 1 addition
        lines(
          i64.mul(xi, Y[j]),
          didCarry && i64.add(), // add carry from stack
          i64.mul(qi, P[j]),
          i64.add(),
          local.set(S[j - 1])
        );
      }
    });
    // outside i loop: final pass of collecting carries
    comment("final carrying & storing");
    for (let j = 1; j < n; j++) {
      lines(
        i64.store(xy, i64.and(S[j - 1], wordMax), { offset: 8 * (j - 1) }),
        local.set(S[j], i64.add(S[j], i64.shr_u(S[j - 1], w)))
      );
    }
    line(i64.store(xy, S[n - 1], { offset: 8 * (n - 1) }));
  });
}

/**
 * addition modulo 2p
 * @param {any} writer
 * @param {bigint} p
 * @param {number} w
 */
function add(writer, p, w) {
  let { n, wordMax } = montgomeryParams(p, w);
  // constants
  let P2 = bigintToLegs(2n * p, w, n);
  let { line, lines, comment, join } = writer;
  let { i64, local, local64, param32, br_if } = ops;

  let [x, y, out] = ["$x", "$y", "$out"];
  let [tmp, carry] = ["$tmp", "$carry"];

  function addition({ doReduce }) {
    line(local64(tmp), local64(carry));

    // first loop: x + y
    for (let i = 0; i < n; i++) {
      comment(`i = ${i}`);
      lines(
        // (carry, out[i]) = x[i] + y[i] + carry;
        i64.load(x, { offset: 8 * i }),
        i64.load(y, { offset: 8 * i }),
        join(i64.add(), local.get(carry), i64.add()),
        // split result
        join(local.tee(tmp), i64.const(w), i64.shr_u(), local.set(carry)),
        i64.store(out, i64.and(tmp, wordMax), { offset: 8 * i })
      );
    }
    if (!doReduce) return;
    // second loop: check if we overflowed by checking x + y < 2p
    block(writer, () => {
      for (let i = n - 1; i >= 0; i--) {
        lines(
          // if (out[i] < 2p[i]) return
          local.set(tmp, i64.load(out, { offset: 8 * i })),
          br_if(1, i64.lt_u(tmp, P2[i])),
          // if (out[i] !== 2p[i]) break;
          br_if(0, i64.ne(tmp, P2[i]))
        );
      }
    });
    // third loop
    // if we're here, t >= 2p, so do t - 2p to get back in 0,..,2p-1
    line(local.set(carry, i64.const(1)));
    for (let i = 0; i < n; i++) {
      comment(`i = ${i}`);
      lines(
        // (carry, out[i]) = (2^w - 1 - 2p[i]) + out[i] + carry;
        i64.const(wordMax - P2[i]),
        i64.load(out, { offset: 8 * i }),
        i64.add(),
        local.get(carry),
        i64.add(),
        local.set(tmp),
        i64.store(out, i64.and(tmp, wordMax), { offset: 8 * i }),
        local.set(carry, i64.shr_u(tmp, w))
      );
    }
  }

  addFuncExport(writer, "add");
  func(writer, "add", [param32(out), param32(x), param32(y)], () =>
    addition({ doReduce: true })
  );

  addFuncExport(writer, "addNoReduce");
  func(writer, "addNoReduce", [param32(out), param32(x), param32(y)], () =>
    addition({ doReduce: false })
  );
}

/**
 * subtraction modulo 2p
 * @param {any} writer
 * @param {bigint} p
 * @param {number} w
 */
function subtract(writer, p, w) {
  let { n, wordMax, R } = montgomeryParams(p, w);
  // constants
  let Rminus2P = bigintToLegs(R - 2n * p, w, n);
  let { line, lines, comment } = writer;
  let { i64, local, local64, param32 } = ops;

  let [x, y, out] = ["$x", "$y", "$out"];
  let [tmp, carry] = ["$tmp", "$carry"];

  function subtraction({ doReduce }) {
    line(local64(tmp), local64(carry));

    // first loop: x - y
    line(local.set(carry, i64.const(1)));
    for (let i = 0; i < n; i++) {
      comment(`i = ${i}`);
      lines(
        // (carry, out[i]) = (2^w - 1) + x[i] - y[i] + carry;
        i64.const(wordMax),
        i64.load(x, { offset: 8 * i }),
        i64.add(),
        i64.load(y, { offset: 8 * i }),
        i64.sub(),
        local.get(carry),
        i64.add(),
        local.set(tmp),
        i64.store(out, i64.and(tmp, wordMax), { offset: 8 * i }),
        local.set(carry, i64.shr_u(tmp, w))
      );
    }
    if (!doReduce) return;
    // check if we underflowed by checking carry === 1 (in that case, we didn't and can return)
    lines(i64.eq(carry, 1), `if return end`);
    // second loop
    // if we're here, y > x and out = x - y + R, while we want x - y + 2p
    // so do (out - (R - 2p))
    line(local.set(carry, i64.const(1)));
    for (let i = 0; i < n; i++) {
      comment(`i = ${i}`);
      lines(
        // (carry, out[i]) = (2**w - 1 - (R - 2*p)[i]) + out[i] + carry;
        i64.const(wordMax - Rminus2P[i]),
        i64.load(out, { offset: 8 * i }),
        i64.add(),
        local.get(carry),
        i64.add(),
        local.set(tmp),
        i64.store(out, i64.and(tmp, wordMax), { offset: 8 * i }),
        local.set(carry, i64.shr_u(tmp, w))
      );
    }
  }

  addFuncExport(writer, "subtract");
  func(writer, "subtract", [param32(out), param32(x), param32(y)], () =>
    subtraction({ doReduce: true })
  );

  addFuncExport(writer, "subtractNoReduce");
  func(writer, "subtractNoReduce", [param32(out), param32(x), param32(y)], () =>
    subtraction({ doReduce: false })
  );
}

/**
 * reduce in place from modulo 2*d*p to modulo d*p, i.e.
 * if (x > d*p) x -= d*p
 * (condition: d*p < R = 2^(n*w); we always have d=1 for now but different ones could be used
 * once we try supporting less reductions in add/sub)
 * @param {any} writer
 * @param {bigint} p
 * @param {number} w
 */
function reduce(writer, p, w, d = 1) {
  let { n, wordMax } = montgomeryParams(p, w);
  // constants
  let dp = bigintToLegs(BigInt(d) * p, w, n);
  let { line, lines, comment } = writer;
  let { i64, local, local64, param32, br_if } = ops;

  let [x] = ["$x"];
  let [tmp, carry] = ["$tmp", "$carry"];

  addFuncExport(writer, "reduce");
  func(writer, "reduce", [param32(x)], () => {
    line(local64(tmp), local64(carry));
    // check if x < p
    block(writer, () => {
      for (let i = n - 1; i >= 0; i--) {
        lines(
          // if (x[i] < d*p[i]) return
          local.set(tmp, i64.load(x, { offset: 8 * i })),
          br_if(1, i64.lt_u(tmp, dp[i])),
          // if (x[i] !== d*p[i]) break;
          br_if(0, i64.ne(tmp, dp[i]))
        );
      }
    });
    // if we're here, t >= dp but we assume t < 2dp, so do t - dp
    line(local.set(carry, i64.const(1)));
    for (let i = 0; i < n; i++) {
      comment(`i = ${i}`);
      lines(
        // (carry, x[i]) = (2^w - 1 - d*p[i]) + x[i] + carry;
        i64.const(wordMax - dp[i]),
        i64.load(x, { offset: 8 * i }),
        i64.add(),
        local.get(carry),
        i64.add(),
        local.set(tmp),
        i64.store(x, i64.and(tmp, wordMax), { offset: 8 * i }),
        local.set(carry, i64.shr_u(tmp, w))
      );
    }
  });
}

/**
 * a core building block for montgomery inversion
 *
 * takes u, s < p. sets k=0. while u is even, update u /= 2 and s *= 2 and increment j++
 * at the end, u <- u/2^k, s <- s*2^k and the new u is odd
 * returns k
 * (the implementation shifts u >> k and s << k at once if k < w, and shifts by whole words until k < w)
 *
 * in the inversion algorithm it's guaranteed that s << k will remain < p,
 * so everything holds modulo p
 *
 * @param {any} writer
 * @param {bigint} p
 * @param {number} w
 */
function makeOdd(writer, p, w) {
  let { n, wordMax } = montgomeryParams(p, w);
  let { line, lines, comment } = writer;
  let {
    i64,
    i32,
    local,
    local64,
    param32,
    result32,
    memory,
    return_,
    br_if,
    br,
  } = ops;

  let [u, s, k, l, tmp] = ["$u", "$s", "$k", "$l", "$tmp"];

  addFuncExport(writer, "makeOdd");
  // idea: we could do a (faster?) constant shift here if k === 1 or 2
  // (the most common case)
  func(writer, "makeOdd", [param32(u), param32(s), result32], () => {
    line(local64(k), local64(l), local64(tmp));

    // k = count_trailing_zeros(u[0])
    lines(local.set(k, i64.ctz(i64.load(u))), i64.eqz(k));
    if_(writer, () => {
      lines(i32.const(0), return_());
    });
    block(writer, () => {
      // while k === 64 (i.e., u[0] === 0), shift by whole words
      // (note: u is not supposed to be 0, so u[0] = 0 implies that u is divisible by 2^w)
      loop(writer, () => {
        lines(
          br_if(1, i64.ne(k, 64)),

          // copy u[1],...,u[n-1] --> u[0],...,u[n-2]
          memory.copy(local.get(u), i32.add(u, 8), i32.const((n - 1) * 8)),
          // u[n-1] = 0
          i64.store(u, 0, { offset: 8 * (n - 1) }),
          // copy s[0],...,u[n-2] --> s[1],...,s[n-1]
          memory.copy(i32.add(s, 8), local.get(s), i32.const((n - 1) * 8)),
          // s[0] = 0
          i64.store(s, 0),

          local.set(k, i64.ctz(i64.load(u))),
          br(0)
        );
      });
    });

    // here we know that k \in 0,...,w-1
    // l = w - k
    line(local.set(l, i64.sub(w, k)));
    comment("u >> k");
    // for (let i = 0; i < n-1; i++) {
    //   u[i] = (u[i] >> k) | ((u[i + 1] << l) & wordMax);
    // }
    // u[n-1] = u[n-1] >> k;
    line(local.set(tmp, i64.load(u)));
    for (let i = 0; i < n - 1; i++) {
      lines(
        local.get(u),
        i64.shr_u(tmp, k),
        i64.and(
          i64.shl(local.tee(tmp, i64.load(u, { offset: 8 * (i + 1) })), l),
          wordMax
        ),
        i64.or(),
        i64.store("", "", { offset: 8 * i })
      );
    }
    line(i64.store(u, i64.shr_u(tmp, k), { offset: 8 * (n - 1) }));
    comment("s << k");
    // for (let i = 10; i >= 0; i--) {
    //   s[i+1] = (s[i] >> l) | ((s[i+1] << k) & wordMax);
    // }
    // s[0] = (s[0] << k) & wordMax;
    line(local.set(tmp, i64.load(s, { offset: 8 * (n - 1) })));
    for (let i = n - 2; i >= 0; i--) {
      lines(
        local.get(s),
        i64.and(i64.shl(tmp, k), wordMax),
        i64.shr_u(local.tee(tmp, i64.load(s, { offset: 8 * i })), l),
        i64.or(),
        i64.store(null, null, { offset: 8 * (i + 1) })
      );
    }
    line(i64.store(s, i64.and(i64.shl(tmp, k), wordMax)));
    comment("return k");
    line(i32.wrap_i64(local.get(k)));
  });

  // doing the constant 1 shift + a variable shift (which then is often a no-op)
  // turns out to be slower than just doing the variable shift right away
  // addFuncExport(writer, "shiftTogether1");
  // func(writer, "shiftTogether1", [param32(u), param32(s)], () => {
  //   line(local64(tmp));
  //   let k = 1;
  //   let l = w - 1;
  //   comment("u >> 1");
  //   // for (let i = 0; i < n-1; i++) {
  //   //   u[i] = (u[i] >> 1) | ((u[i + 1] << l) & wordMax);
  //   // }
  //   // u[n-1] = u[n-1] >> k;
  //   line(local.set(tmp, i64.load(u)));
  //   for (let i = 0; i < n - 1; i++) {
  //     lines(
  //       local.get(u),
  //       i64.shr_u(tmp, k),
  //       i64.and(
  //         i64.shl(local.tee(tmp, i64.load(u, { offset: 8 * (i + 1) })), l),
  //         wordMax
  //       ),
  //       i64.or(),
  //       i64.store("", "", { offset: 8 * i })
  //     );
  //   }
  //   line(i64.store(u, i64.shr_u(tmp, k), { offset: 8 * (n - 1) }));
  //   comment("s << 1");
  //   // for (let i = 10; i >= 0; i--) {
  //   //   s[i+1] = (s[i] >> l) | ((s[i+1] << k) & wordMax);
  //   // }
  //   // s[0] = (s[0] << k) & wordMax;
  //   line(local.set(tmp, i64.load(s, { offset: 8 * (n - 1) })));
  //   for (let i = n - 2; i >= 0; i--) {
  //     lines(
  //       local.get(s),
  //       i64.and(i64.shl(tmp, k), wordMax),
  //       i64.shr_u(local.tee(tmp, i64.load(s, { offset: 8 * i })), l),
  //       i64.or(),
  //       i64.store(null, null, { offset: 8 * (i + 1) })
  //     );
  //   }
  //   line(i64.store(s, i64.and(i64.shl(tmp, k), wordMax)));
  // });
}

/**
 * various helpers for finite field arithmetic:
 * isEqual, isZero, isGreater, copy
 * @param {any} writer
 * @param {bigint} p
 * @param {number} w
 */
function finiteFieldHelpers(writer, p, w) {
  let { n, wordMax, lengthP } = montgomeryParams(p, w);
  let { line, lines } = writer;
  let { i64, i32, local, local64, param32, result32, return_, br_if, memory } =
    ops;

  let [x, y, xi, yi, bytes, tmp] = ["$x", "$y", "$xi", "$yi", "$bytes", "$tmp"];

  // x === y
  addFuncExport(writer, "isEqual");
  func(writer, "isEqual", [param32(x), param32(y), result32], () => {
    for (let i = 0; i < n; i++) {
      line(
        i64.ne(i64.load(x, { offset: 8 * i }), i64.load(y, { offset: 8 * i }))
      );
      if_(writer, () => {
        line(return_(i32.const(0)));
      });
    }
    line(i32.const(1));
  });

  // x === 0
  addFuncExport(writer, "isZero");
  func(writer, "isZero", [param32(x), result32], () => {
    for (let i = 0; i < n; i++) {
      line(i64.ne(i64.load(x, { offset: 8 * i }), 0));
      if_(writer, () => {
        line(return_(i32.const(0)));
      });
    }
    line(i32.const(1));
  });

  // x > y
  addFuncExport(writer, "isGreater");
  func(writer, "isGreater", [param32(x), param32(y), result32], () => {
    line(local64(xi), local64(yi));
    block(writer, () => {
      for (let i = n - 1; i >= 0; i--) {
        lines(
          local.tee(xi, i64.load(x, { offset: 8 * i })),
          local.tee(yi, i64.load(y, { offset: 8 * i })),
          i64.gt_u()
        );
        if_(writer, () => {
          line(return_(i32.const(1)));
        });
        line(br_if(0, i64.ne(xi, yi)));
      }
    });
    line(i32.const(0));
  });

  // copy contents of y into x
  // this should just be inlined if possible
  addFuncExport(writer, "copy");
  func(writer, "copy", [param32(x), param32(y)], () => {
    line(memory.copy(local.get(x), local.get(y), i32.const(8 * n)));
  });

  // convert between internal format and I/O-friendly, packed byte format
  // method: just pack all the n*w bits into memory contiguously
  let nPackedBytes = Math.ceil(lengthP / 8);
  addFuncExport(writer, "toPackedBytes");
  func(writer, "toPackedBytes", [param32(bytes), param32(x)], () => {
    let offset = 0; // memory offset
    let nRes = 0; // residual bits to write from last iteration

    line(local64(tmp)); // holds bits that aren't written yet
    // write bytes word by word
    for (let i = 0; i < n; i++) {
      // how many bytes to write in this iteration
      let nBytes = Math.floor((nRes + w) / 8); // max number of bytes we can get from residual + this word
      let bytesMask = (1n << (8n * BigInt(nBytes))) - 1n;
      lines(
        // tmp = tmp | (x[i] >> nr)  where nr is the bit length of tmp (nr < 8)
        i64.shl(i64.load(x, { offset: 8 * i }), nRes),
        local.get(tmp),
        i64.or(),
        local.set(tmp),
        // store bytes at current offset
        i64.store(bytes, i64.and(tmp, bytesMask), { offset }),
        // keep residual bits for next iteration
        local.set(tmp, i64.shr_u(tmp, 8 * nBytes))
      );
      offset += nBytes;
      nRes = nRes + w - 8 * nBytes;
    }
    // final round: write residual bits, if there are any
    if (offset < nPackedBytes) line(i64.store(bytes, tmp, { offset }));
  });

  let chunk = "$chunk";

  addFuncExport(writer, "fromPackedBytes");
  func(writer, "fromPackedBytes", [param32(x), param32(bytes)], () => {
    let offset = 0; // bytes offset
    let nRes = 0; // residual bits read in the last iteration

    line(local64(tmp), local64(chunk));
    lines(local.set(tmp, i64.const(0)));
    // read bytes word by word
    for (let i = 0; i < n; i++) {
      // if we can't fill up w bits with the current residual, load a full i64 from bytes
      // (some of that i64 could be garbage, but we'll only use the parts that aren't)
      if (nRes < w) {
        lines(
          // tmp = (bytes << nRes) | tmp
          i64.shl(
            // load 8 bytes at current offset
            // due to the left shift, we lose nRes of them
            local.tee(chunk, i64.load(bytes, { offset })),
            nRes
          ),
          local.get(tmp),
          i64.or(),
          local.set(tmp),
          // store what fits in next word
          i64.store(x, i64.and(tmp, wordMax), { offset: 8 * i }),
          // keep residual bits for next iteration
          local.set(tmp, i64.shr_u(chunk, w - nRes))
        );
        offset += 8;
        nRes = nRes - w + 64;
      } else {
        // otherwise, the current tmp is just what we want!
        lines(
          i64.store(x, i64.and(tmp, wordMax), { offset: 8 * i }),
          local.set(tmp, i64.shr_u(tmp, w))
        );
        nRes = nRes - w;
      }
    }
  });
}

/**
 * alternative addition with a much more efficient overflow check
 * at the cost of n `i64.add`s in first loop
 * -) compute z = (R - 2p) + x + y
 * -) z overflows R <==> x + y >= 2p (this check is just a single i64.eq)
 * -) if z overflows R, implicitly ignore R (highest bit) and return z = x + y - 2p
 * -) if z doesn't overflow, compute z - (R - 2p) = x + y and return it
 * performance is very similar to `add`
 */
function add2(writer, p, w) {
  let { n, wordMax, R } = montgomeryParams(p, w);
  // constants
  let Rminus2P = bigintToLegs(R - 2n * p, w, n);
  let { line, lines, comment, join } = writer;
  let { i64, local, local64, param32 } = ops;

  let [x, y, out] = ["$x", "$y", "$out"];
  let [tmp, carry] = ["$tmp", "$carry"];

  function addition({ doReduce }) {
    line(local64(tmp), local64(carry));

    // first loop: x + y
    for (let i = 0; i < n; i++) {
      comment(`i = ${i}`);
      lines(
        // (carry, out[i]) = x[i] + y[i] + (R - 2p)[i] + carry;
        i64.const(Rminus2P[i]),
        i64.load(x, { offset: 8 * i }),
        i64.add(),
        i64.load(y, { offset: 8 * i }),
        i64.add(),
        local.get(carry),
        i64.add(),
        // split result
        join(local.tee(tmp), i64.const(w), i64.shr_u(), local.set(carry)),
        i64.store(out, i64.and(tmp, wordMax), { offset: 8 * i })
      );
    }
    if (!doReduce) return;
    // check if we overflowed by checking carry === 1 (in that case, we did and can return)
    lines(i64.eq(carry, 1), `if return end`);
    // second loop
    // if we're here, x + y < 2p and out = x + y + R - 2p, while we want x + y
    // so do (out - (R - 2p))
    line(local.set(carry, i64.const(1)));
    for (let i = 0; i < n; i++) {
      comment(`i = ${i}`);
      lines(
        // (carry, out[i]) = (2**w - 1 - (R - 2*p)[i]) + out[i] + carry;
        i64.const(wordMax - Rminus2P[i]),
        i64.load(out, { offset: 8 * i }),
        i64.add(),
        local.get(carry),
        i64.add(),
        local.set(tmp),
        i64.store(out, i64.and(tmp, wordMax), { offset: 8 * i }),
        local.set(carry, i64.shr_u(tmp, w))
      );
    }
  }

  addFuncExport(writer, "add");
  func(writer, "add", [param32(out), param32(x), param32(y)], () =>
    addition({ doReduce: true })
  );

  addFuncExport(writer, "addNoReduce");
  func(writer, "addNoReduce", [param32(out), param32(x), param32(y)], () =>
    addition({ doReduce: false })
  );
}

/**
 * MOSTLY OBSOLETE
 * montgomery product
 *
 * this is specific to w=32, in that two carry variables are needed
 * to efficiently stay within 64 bits
 *
 * @param {bigint} p modulus
 * @param {number} w word size in bits
 */
function multiply32(writer, p, w, { unrollOuter }) {
  let { n, wn, wordMax } = montgomeryParams(p, w);

  // constants
  let mu = modInverse(-p, 1n << wn);
  let P = bigintToLegs(p, w, n);

  let { line, lines, comment, join } = writer;
  let { i64, i32, local, local32, local64, param32 } = ops;

  let [x, y, xy] = ["$x", "$y", "$xy"];

  addFuncExport(writer, "multiply");
  func(writer, "multiply", [param32(xy), param32(x), param32(y)], () => {
    let [tmp, carry1, carry2, qi] = ["$tmp", "$carry1", "$carry2", "$qi"];
    let [xi, i] = ["$xi", "$i"];

    // tmp locals
    line(local64(tmp), local64(carry1), local64(carry2), local64(qi));
    line(local64(xi), local32(i));
    line();
    // locals for input y and output xy
    let Y = defineLocals(writer, "y", n);
    let T = defineLocals(writer, "t", n);
    // load y
    for (let i = 0; i < n; i++) {
      line(local.set(Y[i], i64.load(local.get(y), { offset: i * 8 })));
    }
    line();
    function innerLoop() {
      // j=0 step, where m = m[i] is computed and we neglect t[0]
      comment(`j = 0`);
      comment("(A, tmp) = t[0] + x[i]*y[0]");
      lines(
        local.get(T[0]),
        i64.mul(xi, Y[0]),
        i64.add(),
        local.set(tmp),
        i64.shr_u(tmp, w),
        local.set(carry1),
        i64.and(tmp, wordMax),
        local.set(tmp)
      );
      comment("m = tmp * mu (mod 2^w)");
      lines(
        i64.mul(tmp, mu),
        join(i64.const(wordMax), i64.and()),
        local.set(qi)
      );
      comment("carry = (tmp + m * p[0]) >> w");
      lines(
        local.get(tmp),
        i64.mul(qi, P[0]),
        i64.add(),
        join(i64.const(w), i64.shr_u(), local.set(carry2))
      );
      line();

      for (let j = 1; j < n; j++) {
        comment(`j = ${j}`);
        // NB: this can't overflow 64 bits, because (2^32 - 1)^2 + 2*(2^32 - 1) = 2^64 - 1
        comment("tmp = t[j] + x[i] * y[j] + A");
        lines(
          local.get(T[j]),
          local.get(xi),
          local.get(Y[j]),
          join(i64.mul(), local.get(carry1), i64.add(), i64.add()),
          local.set(tmp)
        );
        comment("A = tmp >> w");
        line(local.set(carry1, i64.shr_u(tmp, w)));
        comment("tmp = (tmp & 0xffffffffn) + m * p[j] + C");
        lines(
          i64.and(tmp, wordMax),
          i64.mul(qi, P[j]),
          join(local.get(carry2), i64.add(), i64.add()),
          local.set(tmp)
        );
        comment("(C, t[j - 1]) = tmp");
        lines(
          local.set(T[j - 1], i64.and(tmp, wordMax)),
          local.set(carry2, i64.shr_u(tmp, w))
        );
        line();
      }
      comment("t[11] = A + C");
      line(local.set(T[n - 1], i64.add(carry1, carry2)));
    }
    if (unrollOuter) {
      for (let i = 0; i < n; i++) {
        comment(`i = ${i}`);
        line(local.set(xi, i64.load(x, { offset: i * 8 })));
        innerLoop();
        line();
      }
    } else {
      forLoop8(writer, i, 0, n, () => {
        line(local.set(xi, i64.load(i32.add(x, i))));
        innerLoop();
      });
    }
    for (let i = 0; i < n; i++) {
      line(i64.store(xy, T[i], { offset: 8 * i }));
    }
  });
}

function benchMultiply(W) {
  let { line } = W;
  let { local, local32, param32, call } = ops;
  let [x, N, i] = ["$x", "$N", "$i"];
  addFuncExport(W, "benchMultiply");
  func(W, "benchMultiply", [param32(x), param32(N)], () => {
    line(local32(i));
    forLoop1(W, i, 0, local.get(N), () => {
      line(call("multiply", local.get(x), local.get(x), local.get(x)));
    });
  });
}
function benchAdd(W) {
  let { line } = W;
  let { local, local32, param32, call } = ops;
  let [x, N, i] = ["$x", "$N", "$i"];
  addFuncExport(W, "benchAdd");
  func(W, "benchAdd", [param32(x), param32(N)], () => {
    line(local32(i));
    forLoop1(W, i, 0, local.get(N), () => {
      line(call("add", local.get(x), local.get(x), local.get(x)));
    });
  });
}
function benchSubtract(W) {
  let { line } = W;
  let { local, local32, param32, call } = ops;
  let [x, N, i, z] = ["$x", "$N", "$i", "$z"];
  addFuncExport(W, "benchSubtract");
  func(W, "benchSubtract", [param32(z), param32(x), param32(N)], () => {
    line(local32(i));
    forLoop1(W, i, 0, local.get(N), () => {
      line(call("subtract", local.get(z), local.get(z), local.get(x)));
    });
  });
}

function moduleWithMemory(writer, comment_, memSize, callback) {
  let { line, comment } = writer;
  comment(comment_);
  module(writer, () => {
    addExport(writer, "memory", ops.memory("memory"));
    line(ops.memory("memory", memSize));
    callback(writer);
  });
}

function defineLocals(t, name, n) {
  let locals = [];
  for (let i = 0; i < n; ) {
    for (let j = 0; j < 4 && i < n; j++, i++) {
      let x = "$" + name + String(i).padStart(2, "0");
      t.write(ops.local64(x) + " ");
      locals.push(x);
    }
    t.line();
  }
  return locals;
}

/**
 * Compute the montgomery radix R=2^K and number of legs n
 * @param {bigint} p modulus
 * @param {number} w word size in bits
 */
function montgomeryParams(p, w) {
  // word size has to be <= 32, to be able to multiply 2 words as i64
  if (w > 32) {
    throw Error("word size has to be <= 32 for efficient multiplication");
  }
  // montgomery radix R should be R = 2^K > 2p,
  // where K is exactly divisible by the word size w
  // i.e., K = n*w, where n is the number of legs our field elements are stored in
  let lengthP = log2(p);
  let minK = lengthP + 1; // want 2^K > 2p bc montgomery mult. is modulo 2p
  // number of legs is smallest n such that K := n*w >= minK
  let n = Math.ceil(minK / w);
  let K = n * w;
  let R = 1n << BigInt(K);
  let wn = BigInt(w);
  return { n, K, R, wn, wordMax: (1n << wn) - 1n, lengthP };
}

/**
 *
 * @param {bigint} p modulus
 * @param {number} w word size
 * @param {import('./finite-field.wat')} wasm
 */
function jsHelpers(p, w, { memory, toPackedBytes, fromPackedBytes }) {
  let { n, wn, wordMax, R, lengthP } = montgomeryParams(p, w);
  let nPackedBytes = Math.ceil(lengthP / 8);
  let memoryBytes = new Uint8Array(memory.buffer);
  let obj = {
    n,
    R,
    /**
     * @param {number} x
     * @param {bigint} x0
     */
    writeBigint(x, x0) {
      let arr = new BigUint64Array(memory.buffer, x, n);
      for (let i = 0; i < n; i++) {
        arr[i] = x0 & wordMax;
        x0 >>= wn;
      }
    },

    /**
     * @param {number} x
     */
    readBigInt(x) {
      let arr = new BigUint64Array(memory.buffer.slice(x, x + n * 8));
      let x0 = 0n;
      let bitPosition = 0n;
      for (let i = 0; i < arr.length; i++) {
        x0 += arr[i] << bitPosition;
        bitPosition += wn;
      }
      return x0;
    },

    initial: 0,
    offset: 0,

    /**
     * @param {number} size size of pointer (default: one field element)
     */
    getPointer(size = n * 8) {
      let pointer = obj.offset;
      obj.offset += size;
      return pointer;
    },

    /**
     * @param {number} N
     * @param {number} size size per pointer (default: one field element)
     */
    getPointers(N, size = n * 8) {
      /**
       * @type {number[]}
       */
      let pointers = Array(N);
      let offset = obj.offset;
      for (let i = 0; i < N; i++) {
        pointers[i] = offset;
        offset += size;
      }
      obj.offset = offset;
      return pointers;
    },

    /**
     * @param {number} N
     */
    getStablePointers(N) {
      let pointers = obj.getPointers(N);
      obj.initial = obj.offset;
      return pointers;
    },

    /**
     * @param {number} size size of pointer (default: one field element)
     */
    getZeroPointer(size = n * 8) {
      let offset = obj.offset;
      let pointer = obj.offset;
      memoryBytes.fill(0, offset, offset + size);
      obj.offset = offset + size;
      return pointer;
    },

    /**
     * @param {number} N
     * @param {number} size size per pointer (default: one field element)
     */
    getZeroPointers(N, size = n * 8) {
      /**
       * @type {number[]}
       */
      let pointers = Array(N);
      let offset = obj.offset;
      new Uint8Array(memory.buffer, offset, N * size).fill(0);
      for (let i = 0; i < N; i++) {
        pointers[i] = offset;
        offset += size;
      }
      obj.offset = offset;
      return pointers;
    },

    resetPointers() {
      obj.offset = obj.initial;
    },

    getOffset() {
      return obj.offset;
    },

    /**
     * @param {number[]} scratch
     * @param {number} pointer
     * @param {Uint8Array} bytes
     */
    writeBytes([tmp], pointer, bytes) {
      let arr = new Uint8Array(memory.buffer, tmp, 8 * n);
      arr.fill(0);
      arr.set(bytes);
      fromPackedBytes(pointer, tmp);
    },
    /**
     * read field element into packed bytes representation
     *
     * @param {number[]} scratch
     * @param {number} pointer
     */
    readBytes([bytesPtr], pointer) {
      toPackedBytes(bytesPtr, pointer);
      return new Uint8Array(
        memory.buffer.slice(bytesPtr, bytesPtr + nPackedBytes)
      );
    },
  };
  return obj;
}
