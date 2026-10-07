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
  // Add and subtract select their result without branches: the reduction
  // condition is data dependent and mispredicts on random field elements.
  const add = func(
    {
      in: [{ out: i32 }, { x: i32 }, { y: i32 }],
      locals: {
        carry: i64,
        borrow: i64,
        keep: i32,
        X: localArray(i64, F.n),
        D: localArray(i64, F.n),
      },
      out: [],
    },
    ({ out, x, y }, { carry, borrow, keep, X, D }) => {
      // The modulus guarantees that the full sum fits in the layout.
      const sumFits = 2n * F.limit <= F.R;
      for (let i = 0; i < F.n; i++) {
        if (i === F.n - 1 && sumFits) {
          local.set(
            X[i],
            i64.add(i64.add(F.loadLimb(x, i), F.loadLimb(y, i)), carry)
          );
        } else {
          i64.add128(F.loadLimb(x, i), 0n, F.loadLimb(y, i), 0n);
          if (i !== 0) i64.add128($, $, carry, 0n);
          local.set(carry, $);
          local.set(X[i], $);
        }
      }
      // D = X - limit; keep X iff X + carry*R < limit, i.e. borrow > carry
      F.subtractConstant(D, X, F.Limit, borrow);
      if (sumFits) local.set(keep, i32.wrap_i64(borrow));
      else local.set(keep, i64.gt_u(borrow, carry));
      F.select(out, X, D, keep);
    }
  );
  const subtract = func(
    {
      in: [{ out: i32 }, { x: i32 }, { y: i32 }],
      locals: { borrow: i64, mask: i64, X: localArray(i64, F.n) },
      out: [],
    },
    ({ out, x, y }, { borrow, mask, X }) => {
      for (let i = 0; i < F.n; i++) {
        i64.sub128(F.loadLimb(x, i), 0n, F.loadLimb(y, i), 0n);
        if (i !== 0) i64.sub128($, $, borrow, 0n);
        local.set(borrow, i64.and($, 1n));
        local.set(X[i], $);
      }
      // X += limit if x < y; the final carry cancels the borrow modulo R
      local.set(mask, i64.sub(0n, borrow));
      for (let i = 0; i < F.n; i++) {
        const limb = i64.and(mask, F.Limit[i]);
        if (i === F.n - 1) {
          local.set(X[i], i64.add(i64.add(X[i], limb), i === 0 ? 0n : borrow));
        } else {
          i64.add128(X[i], 0n, limb, 0n);
          if (i !== 0) i64.add128($, $, borrow, 0n);
          local.set(borrow, $);
          local.set(X[i], $);
        }
      }
      F.store(out, X);
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
      in: [{ out: i32 }, { x: i32 }, { y: i32 }],
      locals: { carry: i64, X: localArray(i64, F.n) },
      out: [],
    },
    ({ out, x, y }, { carry, X }) => {
      for (let i = 0; i < F.n; i++) {
        i64.add128(F.loadLimb(x, i), 0n, F.loadLimb(y, i), 0n);
        if (i !== 0) i64.add128($, $, carry, 0n);
        local.set(carry, $);
        local.set(X[i], $);
      }
      F.store(out, X);
    }
  );
  const subtractNoReduce = func(
    {
      in: [{ out: i32 }, { x: i32 }, { y: i32 }],
      locals: { borrow: i64, X: localArray(i64, F.n) },
      out: [],
    },
    ({ out, x, y }, { borrow, X }) => {
      for (let i = 0; i < F.n; i++) {
        i64.sub128(F.loadLimb(x, i), 0n, F.loadLimb(y, i), 0n);
        if (i !== 0) i64.sub128($, $, borrow, 0n);
        local.set(borrow, i64.and($, 1n));
        local.set(X[i], $);
      }
      F.store(out, X);
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
  const copy = func({ in: [{ x: i32 }, { y: i32 }], out: [] }, ({ x, y }) => {
    local.get(x);
    local.get(y);
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
