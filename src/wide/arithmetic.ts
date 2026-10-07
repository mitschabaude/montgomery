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
  select,
  type Input,
  type Local,
  type LocalArray,
  type Type,
} from "wasmati";
import type { FieldBase } from "./field-base.ts";

export { arithmetic, additionKernels };

// Inputs and outputs are in [0, F.limit): usually [0, 2p), or [0, p)
// when two residues do not fit. Output may alias either input.
// reduce canonicalizes a stored value below min(2p, R).
type AdditionLocals = {
  aCarry: Local<i64>;
  aBorrow: Local<i64>;
  aKeep: Local<i32>;
  aT: Local<i64>[];
  aD: Local<i64>[];
};

/**
 * Modular addition and subtraction on locals. Z may alias X or Y.
 *
 * Both select their result without branches: the reduction condition is data
 * dependent and mispredicts on random field elements.
 */
function additionKernels(F: FieldBase) {
  const n = F.n;
  // The modulus guarantees that the full sum fits in the layout.
  const sumFits = 2n * F.limit <= F.R;
  const locals: {
    aCarry: Type<"i64">;
    aBorrow: Type<"i64">;
    aKeep: Type<"i32">;
    aT: LocalArray<"i64">;
    aD: LocalArray<"i64">;
  } = {
    aCarry: i64,
    aBorrow: i64,
    aKeep: i32,
    aT: localArray(i64, n),
    aD: localArray(i64, n),
  };
  function add(
    {
      aCarry: carry,
      aBorrow: borrow,
      aKeep: keep,
      aT: T,
      aD: D,
    }: AdditionLocals,
    Z: Local<i64>[],
    X: Local<i64>[],
    Y: Local<i64>[]
  ) {
    for (let i = 0; i < n; i++) {
      if (i === n - 1 && sumFits) {
        local.set(T[i], i64.add(i64.add(X[i], Y[i]), i === 0 ? 0n : carry));
      } else {
        i64.add128(X[i], 0n, Y[i], 0n);
        if (i !== 0) i64.add128($, $, carry, 0n);
        local.set(carry, $);
        local.set(T[i], $);
      }
    }
    // D = T - limit; keep T iff T + carry*R < limit, i.e. borrow > carry
    F.subtractConstant(D, T, F.Limit, borrow);
    if (sumFits) local.set(keep, i32.wrap_i64(borrow));
    else local.set(keep, i64.gt_u(borrow, carry));
    for (let i = 0; i < n; i++) {
      local.get(T[i]);
      local.get(D[i]);
      local.get(keep);
      select(i64);
      local.set(Z[i], $);
    }
  }
  function subtract(
    { aBorrow: borrow, aCarry: carry, aT: T }: AdditionLocals,
    Z: Local<i64>[],
    X: Local<i64>[],
    Y: Local<i64>[]
  ) {
    // the borrow is the high word of each difference, 0 or -1, which is
    // added to the next one as a signed 128-bit value
    for (let i = 0; i < n; i++) {
      i64.sub128(X[i], 0n, Y[i], 0n);
      if (i !== 0) i64.add128($, $, borrow, borrow);
      local.set(borrow, $);
      local.set(T[i], $);
    }
    // T += limit if x < y, with the final borrow as mask. the final carry
    // cancels the borrow modulo R. zero limbs of the limit only pass on
    // the carry
    let hasCarry = false;
    for (let i = 0; i < n; i++) {
      const L = F.Limit[i];
      const limb = () => (L === -1n ? local.get(borrow) : i64.and(borrow, L));
      if (i === n - 1) {
        let sum: Input<i64> = T[i];
        if (L !== 0n) sum = i64.add(sum, limb());
        if (hasCarry) sum = i64.add(sum, carry);
        local.set(Z[i], sum);
      } else if (L === 0n && !hasCarry) {
        local.set(Z[i], T[i]);
      } else {
        if (L === 0n) i64.add128(T[i], 0n, carry, 0n);
        else {
          i64.add128(T[i], 0n, limb(), 0n);
          if (hasCarry) i64.add128($, $, carry, 0n);
        }
        local.set(carry, $);
        local.set(Z[i], $);
        hasCarry = true;
      }
    }
  }
  return { locals, add, subtract };
}

function arithmetic(F: FieldBase) {
  const K = additionKernels(F);
  const [add, subtract] = [K.add, K.subtract].map((kernel) =>
    func(
      {
        in: [{ out: i32 }, { x: i32 }, { y: i32 }],
        locals: {
          ...K.locals,
          X: localArray(i64, F.n),
          Y: localArray(i64, F.n),
        },
        out: [],
      },
      ({ out, x, y }, L) => {
        F.load(L.X, x);
        F.load(L.Y, y);
        kernel(L, L.X, L.X, L.Y);
        F.store(out, L.X);
      }
    )
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
        if_(() => {
          i32.const(1);
          return_();
        });
        i64.lt_u(F.loadLimb(x, i), F.loadLimb(y, i));
        if_(() => {
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
        if_(() => {
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
      if_(() => {
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
