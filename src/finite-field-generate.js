import { bigintToLegs, log2, mapRange } from "./util.js";
import fs from "node:fs/promises";
import { modInverse } from "./finite-field.js";
import {
  addExport,
  addFuncExport,
  block,
  compileWat,
  forLoop1,
  forLoop8,
  func,
  interpretWat,
  ops,
  Writer,
} from "./wasm-generate.js";

export {
  jsHelpers,
  generateMultiply,
  generateMultiply32,
  benchMultiply,
  moduleWithMemory,
  interpretWat,
  montgomeryParams,
};

let p =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;

let isMain = process.argv[1] === import.meta.url.slice(7);

if (isMain) {
  {
    let w = 30;
    let { n } = montgomeryParams(p, w);
    let writer = Writer();
    moduleWithMemory(
      writer,
      `;; generated for w=${w}, n=${n}, n*w=${n * w}`,
      () => {
        generateMultiply(writer, p, w);
        benchMultiply(writer);
      }
    );
    // let js = await compileWat(writer);
    // console.log(writer.text);
    await fs.writeFile(`./src/finite-field.${w}.gen.wat`, writer.text);
    // await fs.writeFile(`./src/finite-field.${w}.gen.wat.js`, js);
  }

  {
    let w = 32;
    let { n } = montgomeryParams(p, w);
    let writer = Writer();
    moduleWithMemory(
      writer,
      `;; generated for w=${w}, n=${n}, n*w=${n * w}`,
      () => {
        generateMultiply32(writer, p, w, { unrollOuter: false });
        benchMultiply(writer);
      }
    );
    // let js = await compileWat(writer);
    await fs.writeFile("./src/finite-field.32.gen.wat", writer.text);
    // await fs.writeFile("./src/finite-field.32.gen.wat.js", js);
  }
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
 * - important: be flexible w.r.t. w; the literature says w=32, but that's not be ideal here
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
function generateMultiply(writer, p, w) {
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
  let { i64, i32, local, local32, local64, param32 } = ops;

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
    // load y
    for (let i = 0; i < n; i++) {
      line(local.set(Y[i], i64.load(`offset=${i * 8}`, local.get(y))));
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
        i64.store(`offset=${8 * (j - 1)}`, xy, i64.and(S[j - 1], wordMax)),
        local.set(S[j], i64.add(S[j], i64.shr_u(S[j - 1], w)))
      );
    }
    line(i64.store(`offset=${8 * (n - 1)}`, xy, S[n - 1]));
  });
}

/**
 * montgomery product
 *
 * this is specific to w=32, in that two carry variables are needed
 * to efficiently stay within 64 bits
 *
 * @param {bigint} p modulus
 * @param {number} w word size in bits
 */
function generateMultiply32(writer, p, w, { unrollOuter }) {
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
      line(local.set(Y[i], i64.load(`offset=${i * 8}`, local.get(y))));
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
        line(local.set(xi, i64.load(`offset=${i * 8}`, x)));
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
      line(i64.store(`offset=${8 * i}`, xy, T[i]));
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

function moduleWithMemory(writer, comment_, callback) {
  let { line, comment } = writer;
  comment(comment_);
  block("module")(writer, [], () => {
    addExport(writer, "memory", ops.memory("memory"));
    line(ops.memory("memory", 100));
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
  return { n, K, R, wn, wordMax: (1n << wn) - 1n };
}

/**
 *
 * @param {bigint} p modulus
 * @param {number} w word size
 */
function jsHelpers(p, w, memory) {
  let { n, wn, wordMax, R } = montgomeryParams(p, w);
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

    offset: 0,

    /**
     * @param {number} N
     */
    getPointers(N) {
      /**
       * @type {number[]}
       */
      let pointers = Array(N);
      let offset = obj.offset;
      let n8 = n * 8;
      for (let i = 0; i < N; i++) {
        pointers[i] = offset;
        offset += n8;
      }
      obj.offset = offset;
      return pointers;
    },
    resetPointers() {
      obj.offset = 0;
    },
  };
  return obj;
}
