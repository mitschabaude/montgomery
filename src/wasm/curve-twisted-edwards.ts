import { call, func, i32, if_, return_ } from "wasmati";
import { type FieldBackend } from "../field-backend.ts";
import { ImplicitMemory } from "./wasm-util.ts";
import { fieldFormulas } from "./formula.ts";

export { twistedEdwardsOps };

/**
 * Wasm operations on points of a twisted Edwards curve with a = -1, in
 * extended coordinates (x, y, z, t), written once against the field backend.
 *
 * The dedicated additions are the hot path of the MSM. With field kernels,
 * each of them is a single function with its field elements in locals. The
 * unified additions they fall back to, which also double, call the field
 * functions, with `scratch` as contiguous memory for the field elements a
 * formula needs; the counts are given for each operation.
 */
function twistedEdwardsOps(
  implicitMemory: ImplicitMemory,
  Field: FieldBackend
) {
  const S = Field.size;
  const fused = fieldFormulas(Field, implicitMemory, {
    fuse: true,
    nElements: 24,
  });
  const unfused = fieldFormulas(Field, implicitMemory, { fuse: false });

  /**
   * P3 = P1 +- P2, with Z2 = 1 if mixed, given k = 2d. Complete formula; P3
   * may alias P1 and P2.
   * scratch: 9 field elements
   */
  function edwardsAddition({
    isSubtract,
    isMixed,
  }: {
    isSubtract: boolean;
    isMixed: boolean;
  }) {
    return func(
      {
        in: [
          { scratch: i32 },
          { p3: i32 },
          { p1: i32 },
          { p2: i32 },
          { k: i32 },
        ],
        out: [],
      },
      ({ scratch, p3, p1, p2, k }, L) => {
        let f = unfused.context(L, scratch, 9);
        let X1 = f.input(p1);
        let Y1 = f.input(p1, S);
        let Z1 = f.input(p1, 2 * S);
        let T1 = f.input(p1, 3 * S);
        let X2 = f.input(p2);
        let Y2 = f.input(p2, S);
        let Z2 = isMixed ? undefined : f.input(p2, 2 * S);
        let T2 = f.input(p2, 3 * S);
        let [tmp, A, B, C, D, E, F, G, H] = Array.from({ length: 9 }, () =>
          f.element()
        );
        // http://hyperelliptic.org/EFD/g1p/auto-twisted-extended-1.html#addition-add-2008-hwcd-3
        // A = (Y1 - X1)(Y2 -+ X2)
        f.subtractLoose(A, Y1, X1);
        if (isSubtract) f.addLoose(tmp, Y2, X2);
        else f.subtractLoose(tmp, Y2, X2);
        f.multiply(A, A, tmp);
        // B = (Y1 + X1)(Y2 +- X2)
        f.addLoose(B, Y1, X1);
        if (isSubtract) f.subtractLoose(tmp, Y2, X2);
        else f.addLoose(tmp, Y2, X2);
        f.multiply(B, B, tmp);
        // C = T1 k (+-T2)
        if (isSubtract) {
          f.negate(D, T2);
          f.multiply(C, T1, D);
        } else f.multiply(C, T1, T2);
        f.multiply(C, C, f.input(k));
        // D = 2 Z1 Z2
        if (Z2 === undefined) f.addLoose(D, Z1, Z1);
        else {
          f.multiply(D, Z1, Z2);
          f.addLoose(D, D, D);
        }
        // E = B - A, F = D - C, G = D + C, H = B + A
        f.subtractLoose(E, B, A);
        f.subtractLoose(F, D, C);
        f.addLoose(G, D, C);
        f.addLoose(H, B, A);
        let X3 = f.output(p3);
        let Y3 = f.output(p3, S);
        let Z3 = f.output(p3, 2 * S);
        let T3 = f.output(p3, 3 * S);
        f.multiply(X3, E, F);
        f.multiply(Y3, G, H);
        f.multiply(T3, E, H);
        f.multiply(Z3, F, G);
        f.commit(X3, Y3, Z3, T3);
      }
    );
  }

  /**
   * P3 = P1 +- P2, with Z2 = 1 if mixed: dedicated addition for a = -1,
   * http://hyperelliptic.org/EFD/g1p/auto-twisted-extended-1.html#addition-add-2008-hwcd-4
   * and #addition-madd-2008-hwcd-4. 7M mixed, 8M otherwise, no curve constant.
   *
   * The formula degenerates exactly when F = H = 0, i.e. P1 = +-P2 doubles;
   * then it falls back to the unified addition, which gets k = 2d.
   * P3 may alias P1 and P2.
   * scratch: 9 field elements
   */
  function edwardsDedicatedAddition({
    isSubtract,
    isMixed,
    unified,
  }: {
    isSubtract: boolean;
    isMixed: boolean;
    unified: ReturnType<typeof edwardsAddition>;
  }) {
    return func(
      {
        in: [
          { scratch: i32 },
          { p3: i32 },
          { p1: i32 },
          { p2: i32 },
          { k: i32 },
        ],
        locals: fused.locals,
        out: [],
      },
      ({ scratch, p3, p1, p2, k }, L) => {
        let f = fused.context(L, scratch, 9);
        let X1 = f.input(p1);
        let Y1 = f.input(p1, S);
        let Z1 = f.input(p1, 2 * S);
        let T1 = f.input(p1, 3 * S);
        let X2 = f.input(p2);
        let Y2 = f.input(p2, S);
        let Z2 = isMixed ? undefined : f.input(p2, 2 * S);
        let T2 = f.input(p2, 3 * S);
        let [tmp, A, B, C, D, E, F, G, H] = Array.from({ length: 9 }, () =>
          f.element()
        );
        // with P2 negated, X2 -> -X2 and T2 -> -T2
        // A = (Y1 - X1)(Y2 + X2)
        f.subtractLoose(A, Y1, X1);
        if (isSubtract) f.subtractLoose(tmp, Y2, X2);
        else f.addLoose(tmp, Y2, X2);
        f.multiply(A, A, tmp);
        // B = (Y1 + X1)(Y2 - X2)
        f.addLoose(B, Y1, X1);
        if (isSubtract) f.addLoose(tmp, Y2, X2);
        else f.subtractLoose(tmp, Y2, X2);
        f.multiply(B, B, tmp);
        // C = 2 Z1 T2
        f.add(tmp, T2, T2);
        if (isSubtract) f.negate(tmp, tmp);
        f.multiply(C, Z1, tmp);
        // D = 2 T1 Z2
        f.add(D, T1, T1);
        if (Z2 !== undefined) f.multiply(D, D, Z2);
        // F = B - A, G = B + A. the result is (EF, GH, EH, FG), which is
        // correct iff Z3 = FG is nonzero. this excludes equal points, and
        // some sums with points of small order
        f.subtract(F, B, A);
        f.add(G, B, A);
        f.reduce(F);
        f.reduce(G);
        let zero = f.input(fused.zeroPtr);
        f.isEqual(F, zero);
        f.isEqual(G, zero);
        i32.or();
        if_({ likely: false }, () => {
          call(unified, { scratch, p3, p1, p2, k });
          return_();
        });
        // E = D + C, H = D - C
        f.addLoose(E, D, C);
        f.subtract(H, D, C);
        let X3 = f.output(p3);
        let Y3 = f.output(p3, S);
        let Z3 = f.output(p3, 2 * S);
        let T3 = f.output(p3, 3 * S);
        f.multiply(X3, E, F);
        f.multiply(Y3, G, H);
        f.multiply(T3, E, H);
        f.multiply(Z3, F, G);
        f.commit(X3, Y3, Z3, T3);
      }
    );
  }

  const unifiedEdwards = {
    add: edwardsAddition({ isSubtract: false, isMixed: false }),
    addMixed: edwardsAddition({ isSubtract: false, isMixed: true }),
    subMixed: edwardsAddition({ isSubtract: true, isMixed: true }),
  };

  return {
    addEdwards: edwardsDedicatedAddition({
      isSubtract: false,
      isMixed: false,
      unified: unifiedEdwards.add,
    }),
    addMixedEdwards: edwardsDedicatedAddition({
      isSubtract: false,
      isMixed: true,
      unified: unifiedEdwards.addMixed,
    }),
    subMixedEdwards: edwardsDedicatedAddition({
      isSubtract: true,
      isMixed: true,
      unified: unifiedEdwards.subMixed,
    }),
    doubleEdwards: unifiedEdwards.add,
  };
}
