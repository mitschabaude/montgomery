import { $, func, i32, i64, if_, local, memory, return_ } from "wasmati";
import type { FieldBase } from "./field-base.ts";

export { arithmetic };

// Inputs and outputs are in [0, F.limit): usually [0, 2p), or [0, p)
// when two residues do not fit. Output may alias either input.
// reduce canonicalizes a stored value below min(2p, R).
function arithmetic(F: FieldBase) {
  const limbs = Array(F.n).fill(i64) as (typeof i64)[];
  const add = func(
    { in: [i32, i32, i32], locals: [i64, i32, ...limbs], out: [] },
    ([z, x, y], [carry, subtract, ...X]) => {
      for (let i = 0; i < F.n; i++) {
        i64.add128(F.loadLimb(x, i), 0n, F.loadLimb(y, i), 0n);
        if (i !== 0) i64.add128($, $, carry, 0n);
        local.set(carry, $);
        local.set(X[i], $);
      }
      F.reduceLocals(X, carry, carry, subtract, F.Limit, F.Limit);
      F.store(z, X);
    }
  );
  const subtract = func(
    { in: [i32, i32, i32], locals: [i64, ...limbs], out: [] },
    ([z, x, y], [borrow, ...X]) => {
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
    { in: [i32], locals: [i64, i32, ...limbs], out: [] },
    ([x], [borrow, subtract, ...X]) => {
      F.load(X, x);
      F.reduceLocals(X, 0n, borrow, subtract);
      F.store(x, X);
    }
  );
  const isEqual = func({ in: [i32, i32], out: [i32] }, ([x, y]) => {
    for (let i = 0; i < F.n; i++) {
      i64.ne(F.loadLimb(x, i), F.loadLimb(y, i));
      if_(null, () => {
        i32.const(0);
        return_();
      });
    }
    i32.const(1);
  });
  const isZero = func({ in: [i32], out: [i32] }, ([x]) => {
    for (let i = 0; i < F.n; i++) {
      i64.ne(F.loadLimb(x, i), 0n);
      if_(null, () => {
        i32.const(0);
        return_();
      });
    }
    i32.const(1);
  });
  const copy = func({ in: [i32, i32], out: [] }, ([z, x]) => {
    local.get(z);
    local.get(x);
    i32.const(F.size);
    memory.copy();
  });
  return { add, subtract, reduce, isEqual, isZero, copy };
}
