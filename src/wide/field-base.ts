import {
  $,
  block,
  br_if,
  i32,
  i64,
  local,
  select as select_,
  type Input,
  type Local,
} from "wasmati";
import { inverse } from "../bigint/field.ts";
import { assert } from "../util.ts";

export { createField, type FieldBase, mask64 };

const mask64 = (1n << 64n) - 1n;
type FieldBase = ReturnType<typeof createField>;

function createField(p: bigint) {
  assert(
    p > 2n && (p & 1n) === 1n,
    "wide Montgomery arithmetic requires an odd modulus > 2"
  );
  const n = Math.ceil(p.toString(2).length / 64);
  const R = 1n << BigInt(64 * n);
  const P = Array.from({ length: n }, (_, i) =>
    BigInt.asIntN(64, p >> BigInt(64 * i))
  );
  const lazy = 2n * p < R;
  const limit = lazy ? 2n * p : p;
  const Limit = Array.from({ length: n }, (_, i) =>
    BigInt.asIntN(64, limit >> BigInt(64 * i))
  );
  const mu = BigInt.asIntN(64, inverse(-p, 1n << 64n));

  function loadLimb(x: Local<i32>, i: number) {
    return i64.load({ offset: 8 * i }, x);
  }
  function storeLimb(x: Local<i32>, i: number, value: Input<i64>) {
    i64.store({ offset: 8 * i }, x, value);
  }
  function load(X: Local<i64>[], x: Local<i32>) {
    X.forEach((xi, i) => local.set(xi, loadLimb(x, i)));
  }
  function store(x: Local<i32>, X: Local<i64>[]) {
    X.forEach((xi, i) => storeLimb(x, i, xi));
  }

  // Compare X + high*R to threshold and subtract subtrahend once.
  // Keeping high is necessary for moduli close to R (e.g. secp256k1).
  function reduceLocals(
    X: Local<i64>[],
    high: Input<i64>,
    borrow: Local<i64>,
    threshold = P,
    subtrahend = P
  ) {
    block(null, (done) => {
      block(null, (needsSubtract) => {
        if (high !== 0n) {
          i64.ne(high, 0n);
          br_if(needsSubtract);
        }
        for (let i = n - 1; i >= 0; i--) {
          i64.lt_u(X[i], threshold[i]);
          br_if(done);
          i64.ne(X[i], threshold[i]);
          br_if(needsSubtract);
        }
      });
      subtractConstant(X, X, subtrahend, borrow);
    });
  }

  // D = X - C for a constant C, with the final borrow (0 or 1) in borrow.
  // A constant limb other than UINT64_MAX can absorb the incoming borrow
  // without overflowing, so only one widening subtraction is needed.
  function subtractConstant(
    D: Local<i64>[],
    X: Local<i64>[],
    C: bigint[],
    borrow: Local<i64>
  ) {
    for (let i = 0; i < n; i++) {
      if (i === 0) i64.sub128(X[i], 0n, C[i], 0n);
      else if (C[i] !== -1n) i64.sub128(X[i], 0n, i64.add(C[i], borrow), 0n);
      else {
        i64.sub128(X[i], 0n, C[i], 0n);
        i64.sub128($, $, borrow, 0n);
      }
      local.set(borrow, i64.and($, 1n));
      local.set(D[i], $);
    }
  }

  // Store condition ? X : Y without branching.
  function select(
    x: Local<i32>,
    X: Local<i64>[],
    Y: Local<i64>[],
    condition: Local<i32>
  ) {
    for (let i = 0; i < n; i++) {
      local.get(X[i]);
      local.get(Y[i]);
      local.get(condition);
      select_(i64);
      storeLimb(x, i, $);
    }
  }

  return {
    p,
    n,
    w: 64,
    size: 8 * n,
    R,
    P,
    mu,
    lazy,
    limit,
    Limit,
    loadLimb,
    storeLimb,
    load,
    store,
    reduceLocals,
    subtractConstant,
    select,
  };
}
