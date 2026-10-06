import { localArray, $, func, i32, i64, local, type Local } from "wasmati";
import type { FieldBase } from "./field-base.ts";

export { multiplyMontgomery };

function multiplyMontgomery(F: FieldBase) {
  // T < p + inputLimit throughout CIOS. With this headroom there is
  // no extra carry limb; decide that once while generating the module.
  const noOverflow = F.p + F.limit <= F.R;

  // CIOS with separate product and reduction passes. Each multiply-add fits
  // exactly in 128 bits: (B-1)^2 + (B-1) + (B-1) = B^2-1, B = 2^64.
  // Combining two full-width products into one accumulator would need 129 bits.
  function kernel(
    z: Local<i32>,
    X: Local<i64>[],
    Y: Local<i64>[],
    T: Local<i64>[],
    carry: Local<i64>,
    q: Local<i64>
  ) {
    function addMul(
      a: Local<i64>,
      b: Local<i64> | bigint,
      t: Local<i64>,
      first: boolean
    ) {
      if (b === 0n) {
        i64.add128(t, 0n, carry, 0n);
      } else {
        if (b === 1n) i64.add128(a, 0n, t, 0n);
        else {
          i64.mul_wide_u(a, b);
          i64.add128($, $, t, 0n);
        }
        if (!first) i64.add128($, $, carry, 0n);
      }
      local.set(carry, $);
    }
    for (let i = 0; i < F.n; i++) {
      local.set(carry, 0n);
      for (let j = 0; j < F.n; j++) {
        addMul(X[i], Y[j], T[j], j === 0);
        local.set(T[j], $);
      }
      if (noOverflow) local.set(T[F.n], carry);
      else {
        i64.add128(T[F.n], 0n, carry, 0n);
        local.set(T[F.n + 1], $);
        local.set(T[F.n], $);
      }

      local.set(q, i64.mul(T[0], F.mu));
      local.set(carry, 0n);
      for (let j = 0; j < F.n; j++) {
        addMul(q, F.P[j], T[j], j === 0);
        if (j === 0) {
          // The low word is zero by construction; discard it.
          local.set(T[0], $);
        } else {
          local.set(T[j - 1], $);
        }
      }
      if (noOverflow) {
        local.set(T[F.n - 1], i64.add(T[F.n], carry));
        local.set(T[F.n], 0n);
      } else {
        i64.add128(T[F.n], T[F.n + 1], carry, 0n);
        local.set(T[F.n], $);
        local.set(T[F.n - 1], $);
      }
    }
    // REDC gives T < p + x*y/R. For x,y < 2p and 4p <= R,
    // T < 2p already, so no final comparison or subtraction is needed.
    // Otherwise T < 3p (lazy) or < 2p (canonical); one subtraction suffices.
    if (!F.lazy || 4n * F.p > F.R) {
      F.reduceLocals(T.slice(0, F.n), T[F.n], carry, F.Limit);
    }
    F.store(z, T.slice(0, F.n));
  }

  const multiply = func(
    {
      in: [{ z: i32 }, { x: i32 }, { y: i32 }],
      locals: {
        carry: i64,
        q: i64,
        X: localArray(i64, F.n),
        Y: localArray(i64, F.n),
        T: localArray(i64, F.n + 2),
      },
      out: [],
    },
    ({ z, x, y }, { carry, q, X, Y, T }) => {
      F.load(X, x);
      F.load(Y, y);
      kernel(z, X, Y, T, carry, q);
    }
  );
  // Same CIOS algorithm, specialized to load the input only once.
  const square = func(
    {
      in: [{ z: i32 }, { x: i32 }],
      locals: {
        carry: i64,
        q: i64,
        X: localArray(i64, F.n),
        T: localArray(i64, F.n + 2),
      },
      out: [],
    },
    ({ z, x }, { carry, q, X, T }) => {
      F.load(X, x);
      kernel(z, X, X, T, carry, q);
    }
  );
  return { multiply, square };
}
