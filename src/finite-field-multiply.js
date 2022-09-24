import { montgomeryParams } from "./finite-field-generate.js";
import { modInverse } from "./finite-field-js.js";
import { bigintToLegs } from "./util.js";
import {
  addExport,
  addFuncExport,
  forLoop8,
  func,
  ops,
} from "./wasm-generate.js";

export { multiply };

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
  let P4 = bigintToLegs(4n * p, w, n);
  // how much terms we can add before a carry
  let nSafeTerms = 64 - 2 * w + 1;
  // how much j steps we can do before a carry:
  let nSafeSteps = 64 - 2 * w; // OK?
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

  let [x, y, xy] = ["$x", "$y", "$xy"];
  let [tmp] = ["$tmp"];
  let [i, xi, qi] = ["$i", "$xi", "$qi"];

  addFuncExport(writer, "multiply");
  func(writer, "multiply", [param32(xy), param32(x), param32(y)], () => {
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

  /**
   * compute
   *
   * out = x^2 - y - z
   *
   * which is a step in EC addition.
   * allows `out` to be the same pointer as y
   *
   * this works only if 3 terms can be added without carry!
   */
  // let [out, z] = ["$out", "$z"];
  // addFuncExport(writer, "squareSubtractSubtract");
  // func(
  //   writer,
  //   "squareSubtractSubtract",
  //   [param32(out), param32(x), param32(y), param32(z)],
  //   () => {
  //     // locals
  //     line(local64(tmp));
  //     line(local64(qi));
  //     let X = defineLocals(writer, "x", n);
  //     let S = defineLocals(writer, "t", n);

  //     if (countMultiplications) {
  //       line(global.set(multiplyCount, i32.add(global.get(multiplyCount), 1)));
  //     }

  //     // load x
  //     for (let i = 0; i < n; i++) {
  //       line(local.set(X[i], i64.load(local.get(x), { offset: i * 8 })));
  //     }

  //     comment("i = j = 0, do carry, ignore result below carry");
  //     lines(
  //       // tmp = x[0]*x[0] + 4p[0] + y'[0] + z'[0]
  //       i64.mul(X[0], X[0]),
  //       i64.const(P4[0]),
  //       i64.add(),
  //       i64.sub(wordMax, i64.load(y, { offset: 0 })),
  //       i64.add(),
  //       i64.sub(wordMax, i64.load(z, { offset: 0 })),
  //       i64.add(),
  //       // qi = mu * (tmp & wordMax) & wordMax
  //       local.set(tmp),
  //       local.set(qi, i64.and(i64.mul(mu, i64.and(tmp, wordMax)), wordMax)),
  //       local.get(tmp),
  //       // (stack, _) = tmp + qi*p[0]
  //       i64.mul(qi, P[0]),
  //       i64.add(),
  //       join(i64.const(w), i64.shr_u()) // we just put carry on the stack, use it later
  //     );

  //     for (let i = 1; i < n; i++) {
  //       // j=0, compute q_i
  //       let didCarry = false;
  //       let doCarry = 0 % nSafeSteps === 0;
  //       comment("j = 0, do carry, ignore result below carry");
  //       lines(
  //         // tmp = S[0] + x[i]*y[0]
  //         local.get(S[0]),
  //         i64.mul(xi, X[0]),
  //         i64.add(),
  //         // qi = mu * (tmp & wordMax) & wordMax
  //         local.set(tmp),
  //         local.set(qi, i64.and(i64.mul(mu, i64.and(tmp, wordMax)), wordMax)),
  //         local.get(tmp),
  //         // (stack, _) = tmp + qi*p[0]
  //         i64.mul(qi, P[0]),
  //         i64.add(),
  //         join(i64.const(w), i64.shr_u()) // we just put carry on the stack, use it later
  //       );

  //       for (let j = 1; j < n - 1; j++) {
  //         // S[j] + x[i]*y[j] + qi*p[j], or
  //         // stack + S[j] + x[i]*y[j] + qi*p[j]
  //         // ... = S[j-1], or  = (stack, S[j-1])
  //         didCarry = doCarry;
  //         doCarry = j % nSafeSteps === 0;
  //         comment(`j = ${j}${doCarry ? ", do carry" : ""}`);
  //         lines(
  //           local.get(S[j]),
  //           didCarry && i64.add(), // add carry from stack
  //           i64.mul(xi, X[j]),
  //           i64.add(),
  //           i64.mul(qi, P[j]),
  //           i64.add(),
  //           doCarry && join(local.tee(tmp), i64.const(w), i64.shr_u()), // put carry on the stack
  //           doCarry && i64.and(tmp, wordMax), // mod 2^w the current result
  //           local.set(S[j - 1])
  //         );
  //       }
  //       let j = n - 1;
  //       didCarry = doCarry;
  //       doCarry = j % nSafeSteps === 0;
  //       comment(`j = ${j}${doCarry ? ", do carry" : ""}`);
  //       if (doCarry) {
  //         lines(
  //           local.get(S[j]),
  //           didCarry && i64.add(), // add carry from stack
  //           i64.mul(xi, X[j]),
  //           i64.add(),
  //           i64.mul(qi, P[j]),
  //           i64.add(),
  //           doCarry && join(local.tee(tmp), i64.const(w), i64.shr_u()), // put carry on the stack
  //           doCarry && i64.and(tmp, wordMax), // mod 2^w the current result
  //           local.set(S[j - 1])
  //         );
  //         // if the last iteration does a carry, S[n-1] is set to it
  //         lines(local.set(S[j]));
  //       } else {
  //         // if the last iteration doesn't do a carry, then S[n-1] is never set,
  //         // so we also don't have to get it & can save 1 addition
  //         lines(
  //           i64.mul(xi, X[j]),
  //           didCarry && i64.add(), // add carry from stack
  //           i64.mul(qi, P[j]),
  //           i64.add(),
  //           local.set(S[j - 1])
  //         );
  //       }
  //     }
  //     // outside i loop: final pass of collecting carries
  //     comment("final carrying & storing");
  //     for (let j = 1; j < n; j++) {
  //       lines(
  //         i64.store(xy, i64.and(S[j - 1], wordMax), { offset: 8 * (j - 1) }),
  //         local.set(S[j], i64.add(S[j], i64.shr_u(S[j - 1], w)))
  //       );
  //     }
  //     line(i64.store(xy, S[n - 1], { offset: 8 * (n - 1) }));
  //   }
  // );

  let [k] = ["$k"];

  // multiplication by 2^k < 2p
  // TODO: this could be at least 50% faster, but probably not worth it
  // (all the multiplications by 0 and corresponding adds / carries can be saved,
  // the if loop should only go to (w*n-k) // n, and just do one final round
  // of flexible reduction by 2^(w*n-k % n))
  addFuncExport(writer, "leftShift");
  func(writer, "leftShift", [param32(xy), param32(y), param32(k)], () => {
    let [xi0, i0] = ["$xi0", "$i0"];

    // locals
    line(local64(tmp));
    line(local64(qi), local64(xi), local32(i), local32(i0), local32(xi0));
    let Y = defineLocals(writer, "y", n);
    let S = defineLocals(writer, "t", n);

    // load y
    for (let i = 0; i < n; i++) {
      line(local.set(Y[i], i64.load(local.get(y), { offset: i * 8 })));
    }
    // figure out the value of i0, xi0 where 2^k has its bit set
    lines(
      // i0 = k // w, xi0 = 2^(k % w) = 2^(k - i0*w)
      local.set(i0, i32.div_u(k, w)),
      local.set(xi0, i32.shl(1, i32.rem_u(k, w))),
      // local.set(xi0, i32.shl(1, i32.sub(k, i32.mul(i0, w)))),
      local.set(i0, i32.mul(i0, 8))
    );

    forLoop8(writer, i, 0, n, () => {
      // compute x[i]
      line(local.set(xi, i64.extend_i32_u(i32.mul(i32.eq(i, i0), xi0))));

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