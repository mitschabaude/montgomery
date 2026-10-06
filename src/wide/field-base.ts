import {
  $,
  block,
  br,
  br_if,
  i32,
  i64,
  if_,
  local,
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
    subtract: Local<i32>,
    threshold = P,
    subtrahend = P
  ) {
    local.set(subtract, i64.ne(high, 0n));
    i32.eqz(subtract);
    if_(null, () => {
      block(null, (done) => {
        for (let i = n - 1; i >= 0; i--) {
          i64.lt_u(X[i], threshold[i]);
          br_if(done);
          i64.gt_u(X[i], threshold[i]);
          if_(null, () => {
            local.set(subtract, 1);
            br(done);
          });
        }
        local.set(subtract, 1); // X === threshold
      });
    });
    local.get(subtract);
    if_(null, () => {
      local.set(borrow, 0n);
      for (let i = 0; i < n; i++) {
        i64.sub128(X[i], 0n, subtrahend[i], 0n);
        i64.sub128($, $, borrow, 0n);
        local.set(borrow, i64.and($, 1n));
        local.set(X[i], $);
      }
    });
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
  };
}
