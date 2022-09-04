import { bigintToLegs, log2 } from "./util.js";
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

export { jsHelpers, wasmArithmetic };

let p =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;

let isMain = process.argv[1] === import.meta.url.slice(7);

if (isMain) {
  let w = 32;
  let writer = generateMultiply32(p, w);
  finishModule(writer, p, w);
  let js = await compileWat(writer);
  await fs.writeFile("./src/finite-field-gen.32.wat", writer.text);
  await fs.writeFile("./src/finite-field-gen.32.wat.js", js);
}

async function wasmArithmetic(p, w) {
  let writer = generateMultiply32(p, w);
  finishModule(writer, p, w);
  await fs.writeFile("./src/finite-field-gen.32.wat", writer.text);
  return await interpretWat(writer);
}

function finishModule(writer, p, w) {
  let { n } = computeMontgomeryParams(p, w);
  let writer2 = Writer();
  let { line, write, remove, comment } = writer2;
  comment(`;; generated for w=${w}, n=${n}, n*w=${n * w}`);
  block("module")(writer2, [], () => {
    addExport(writer2, "memory", ops.memory("memory"));
    line(ops.memory("memory", 100));
    remove(2);
    write(writer.text);
    line();
  });
  for (let e of writer2.exports) {
    writer.exports.add(e);
  }
  writer.text = writer2.text;
}

/**
 * generate wasm code for montgomery product
 *
 * this is specific to w=32, in that two carry variables are needed
 * to efficiently stay within 64 bits
 *
 * @param {bigint} p modulus
 * @param {number} w word size in bits
 */
function generateMultiply32(p, w) {
  let { n } = computeMontgomeryParams(p, w);

  // constants
  let wn = BigInt(w);
  let wordMax = (1n << wn) - 1n;
  let mu = modInverse(-p, 1n << wn);
  let P = bigintToLegs(p, w, n);

  let W = Writer();
  let { line, lines, comment } = W;
  let { i64, i32, local, param32, local32, call } = ops;
  let join = (...args) => args.join(" ");

  let x = "$x";
  let y = "$y";
  let xy = "$xy";
  let i = "$i";

  W.tab();
  addFuncExport(W, "multiply");
  addFuncExport(W, "benchMultiply");

  func(W, "multiply", [param32(xy), param32(x), param32(y)], () => {
    let tmp = "$tmp";
    let carry1 = "$carry1";
    let carry2 = "$carry2";
    let m = "$m";
    let xi = "$xi";

    // tmp locals
    line(
      local(tmp, "i64"),
      local(carry2, "i64"),
      local(m, "i64"),
      local(carry1, "i64")
    );
    line(local(xi, "i64"), local(i, "i32"));
    line();

    // locals for input y and output xy
    let Y = defineLocals(W, "y", n);
    line();
    let T = defineLocals(W, "t", n);
    line();

    Y.forEach((yi, i) =>
      line(local.set(yi, i64.load(`offset=${i * 8}`, local.get(y))))
    );
    line();
    forLoop8(W, i, 0, n, () => {
      line(local.set(xi, i64.load(i32.add(x, i))));

      // j=0 loop, where m = m[i] is computed and we neglect t[0]
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
        local.set(m)
      );
      comment("carry = (tmp + m * p[0]) >> w");
      lines(
        local.get(tmp),
        i64.mul(m, P[0]),
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
          i64.mul(m, P[j]),
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
    });

    for (let i = 0; i < n; i++) {
      line(i64.store(`offset=${8 * i}`, xy, T[i]));
    }
  });

  let N = "$N";
  func(W, "benchMultiply", [param32(x), param32(N)], () => {
    line(local32(i));
    forLoop1(W, i, 0, local.get(N), () => {
      line(call("multiply", local.get(x), local.get(x), local.get(x)));
    });
  });
  return W;
}

function defineLocals(t, name, n) {
  let locals = [];
  for (let i = 0; i < n; ) {
    for (let j = 0; j < 4 && i < n; j++, i++) {
      let x = "$" + name + String(i).padStart(2, "0");
      t.write(`(local ${x} i64) `);
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
function computeMontgomeryParams(p, w) {
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
  let { n, wn, wordMax, R } = computeMontgomeryParams(p, w);
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
