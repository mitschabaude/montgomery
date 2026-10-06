import {
  localArray,
  $,
  func,
  i32,
  i64,
  if_,
  local,
  memory,
  return_,
} from "wasmati";
import type { FieldBase } from "./field-base.ts";

export { arithmetic };

// Inputs and outputs are in [0, F.limit): usually [0, 2p), or [0, p)
// when two residues do not fit. Output may alias either input.
// reduce canonicalizes a stored value below min(2p, R).
function arithmetic(F: FieldBase) {
  const add = func(
    {
      in: [{ z: i32 }, { x: i32 }, { y: i32 }],
      locals: { carry: i64, X: localArray(i64, F.n) },
      out: [],
    },
    ({ z, x, y }, { carry, X }) => {
      for (let i = 0; i < F.n; i++) {
        if (i === F.n - 1 && 2n * F.limit <= F.R) {
          // The modulus guarantees that the full sum fits in the layout.
          local.set(
            X[i],
            i64.add(i64.add(F.loadLimb(x, i), F.loadLimb(y, i)), carry)
          );
          local.set(carry, 0n);
        } else {
          i64.add128(F.loadLimb(x, i), 0n, F.loadLimb(y, i), 0n);
          if (i !== 0) i64.add128($, $, carry, 0n);
          local.set(carry, $);
          local.set(X[i], $);
        }
      }
      F.reduceLocals(X, carry, carry, F.Limit, F.Limit);
      F.store(z, X);
    }
  );
  const subtract = func(
    {
      in: [{ z: i32 }, { x: i32 }, { y: i32 }],
      locals: { borrow: i64, X: localArray(i64, F.n) },
      out: [],
    },
    ({ z, x, y }, { borrow, X }) => {
      for (let i = 0; i < F.n; i++) {
        i64.sub128(F.loadLimb(x, i), 0n, F.loadLimb(y, i), 0n);
        if (i !== 0) i64.sub128($, $, borrow, 0n);
        local.set(borrow, i64.and($, 1n));
        local.set(X[i], $);
      }
      i64.ne(borrow, 0n);
      if_(null, () => {
        local.set(borrow, 0n);
        for (let i = 0; i < F.n; i++) {
          i64.add128(X[i], 0n, F.Limit[i], 0n);
          i64.add128($, $, borrow, 0n);
          local.set(borrow, $);
          local.set(X[i], $);
        }
      });
      F.store(z, X);
    }
  );
  const reduce = func(
    {
      in: [{ x: i32 }],
      locals: { borrow: i64, X: localArray(i64, F.n) },
      out: [],
    },
    ({ x }, { borrow, X }) => {
      F.load(X, x);
      F.reduceLocals(X, 0n, borrow);
      F.store(x, X);
    }
  );
  // Raw integer operations: callers must ensure the result fits in R.
  // These are used by binary inversion, whose coefficients stay <= p.
  const addNoReduce = func(
    {
      in: [{ z: i32 }, { x: i32 }, { y: i32 }],
      locals: { carry: i64, X: localArray(i64, F.n) },
      out: [],
    },
    ({ z, x, y }, { carry, X }) => {
      for (let i = 0; i < F.n; i++) {
        i64.add128(F.loadLimb(x, i), 0n, F.loadLimb(y, i), 0n);
        if (i !== 0) i64.add128($, $, carry, 0n);
        local.set(carry, $);
        local.set(X[i], $);
      }
      F.store(z, X);
    }
  );
  const subtractNoReduce = func(
    {
      in: [{ z: i32 }, { x: i32 }, { y: i32 }],
      locals: { borrow: i64, X: localArray(i64, F.n) },
      out: [],
    },
    ({ z, x, y }, { borrow, X }) => {
      for (let i = 0; i < F.n; i++) {
        i64.sub128(F.loadLimb(x, i), 0n, F.loadLimb(y, i), 0n);
        if (i !== 0) i64.sub128($, $, borrow, 0n);
        local.set(borrow, i64.and($, 1n));
        local.set(X[i], $);
      }
      F.store(z, X);
    }
  );
  const isGreater = func(
    { in: [{ x: i32 }, { y: i32 }], out: [i32] },
    ({ x, y }) => {
      for (let i = F.n - 1; i >= 0; i--) {
        i64.gt_u(F.loadLimb(x, i), F.loadLimb(y, i));
        if_(null, () => {
          i32.const(1);
          return_();
        });
        i64.lt_u(F.loadLimb(x, i), F.loadLimb(y, i));
        if_(null, () => {
          i32.const(0);
          return_();
        });
      }
      i32.const(0);
    }
  );
  const isEqual = func(
    { in: [{ x: i32 }, { y: i32 }], out: [i32] },
    ({ x, y }) => {
      for (let i = 0; i < F.n; i++) {
        i64.ne(F.loadLimb(x, i), F.loadLimb(y, i));
        if_(null, () => {
          i32.const(0);
          return_();
        });
      }
      i32.const(1);
    }
  );
  const isZero = func({ in: [{ x: i32 }], out: [i32] }, ({ x }) => {
    for (let i = 0; i < F.n; i++) {
      i64.ne(F.loadLimb(x, i), 0n);
      if_(null, () => {
        i32.const(0);
        return_();
      });
    }
    i32.const(1);
  });
  const copy = func({ in: [{ z: i32 }, { x: i32 }], out: [] }, ({ z, x }) => {
    local.get(z);
    local.get(x);
    i32.const(F.size);
    memory.copy();
  });
  return {
    add,
    subtract,
    addNoReduce,
    subtractNoReduce,
    reduce,
    isEqual,
    isGreater,
    isZero,
    copy,
  };
}
