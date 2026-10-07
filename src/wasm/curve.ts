import {
  block,
  br,
  br_if,
  call,
  func,
  i32,
  if_,
  local,
  loop,
  memory,
  return_,
  type Input,
  type Local,
} from "wasmati";
import { type FieldBackend } from "../field-backend.ts";
import { mod } from "../bigint/field-util.ts";
import { ImplicitMemory } from "./wasm-util.ts";
import { fieldFormulas, type Fe, type FormulaContext } from "./formula.ts";

export { curveOps };

/**
 * Wasm curve operations on pointers, written once against the field backend.
 * With field kernels, each operation is a single function with its field
 * elements in locals; otherwise it calls the field functions.
 *
 * Points: affine (x, y, isNonZero byte), projective (x, y, z, isNonZero byte),
 * and extended twisted Edwards (x, y, z, t).
 *
 * Without kernels, `scratch` is contiguous memory for the field elements a
 * formula needs; the counts are given for each operation.
 *
 * @param beta cube root in the base field for the endomorphism
 */
function curveOps(
  implicitMemory: ImplicitMemory,
  Field: FieldBackend,
  beta: bigint
) {
  const S = Field.size;
  const { inverse } = Field;
  const formulas = fieldFormulas(Field, implicitMemory, 24);
  const { locals } = formulas;
  const context = (L: any, scratch: Local<"i32">, maxScratch: number) =>
    formulas.context(L, scratch, maxScratch);
  const copyBytes = (
    target: Input<"i32">,
    source: Input<"i32">,
    length: number
  ) => {
    local.get(target as any);
    local.get(source as any);
    i32.const(length);
    memory.copy();
  };

  // affine

  /**
   * affine addition G3 = G1 + G2, given d = 1/(x2 - x1). G3 may alias G1.
   * scratch: 3 field elements
   */
  const addAffine = func(
    {
      in: [{ scratch: i32 }, { x3: i32 }, { x1: i32 }, { x2: i32 }, { d: i32 }],
      locals,
      out: [],
    },
    ({ scratch, x3, x1, x2, d }, L) => {
      let f = context(L, scratch, 3);
      let M = f.element();
      // m = (y2 - y1) d
      f.subtractLoose(M, f.input(x2, S), f.input(x1, S));
      f.multiply(M, M, f.input(d));
      addAffineGivenSlope(f, x3, x1, x2, M);
    }
  );

  // G3 = G1 + G2 for the slope m; writes G3 after reading G1, G2
  function addAffineGivenSlope(
    f: FormulaContext,
    x3: Local<"i32">,
    x1: Local<"i32">,
    x2: Local<"i32">,
    M: Fe
  ) {
    let X1 = f.input(x1);
    let X2 = f.input(x2);
    let Y2 = f.input(x2, S);
    let X3 = f.element();
    let Y3 = f.output(x3, S);
    // x3 = m^2 - x1 - x2
    f.square(X3, M);
    f.subtract(X3, X3, X1);
    f.subtract(X3, X3, X2);
    // y3 = (x2 - x3) m - y2
    f.subtractLoose(Y3, X2, X3);
    f.multiply(Y3, Y3, M);
    f.subtract(Y3, Y3, Y2);
    f.store(x3, 0, X3);
    f.commit(Y3);
    i32.store8({ offset: 2 * S }, x3, 1);
  }

  /**
   * affine doubling H = 2G, given d = 1/(2y). H may alias G.
   * scratch: 4 field elements
   */
  const doubleAffine = func(
    {
      in: [{ scratch: i32 }, { xOut: i32 }, { x: i32 }, { d: i32 }],
      locals,
      out: [],
    },
    ({ scratch, xOut, x, d }, L) => {
      let f = context(L, scratch, 4);
      let X = f.input(x);
      let Y = f.input(x, S);
      let M = f.element();
      let T = f.element();
      let X2 = f.element();
      let Y2 = f.element();
      // m = 3x^2 d
      f.square(M, X);
      f.add(T, M, M);
      f.add(M, T, M);
      f.multiply(M, M, f.input(d));
      // x2 = m^2 - 2x
      f.square(X2, M);
      f.add(T, X, X);
      f.subtract(X2, X2, T);
      // y2 = (x - x2) m - y
      f.subtract(Y2, X, X2);
      f.multiply(Y2, Y2, M);
      f.subtract(Y2, Y2, Y);
      f.store(xOut, 0, X2);
      f.store(xOut, S, Y2);
      i32.store8({ offset: 2 * S }, xOut, 1);
    }
  );

  /**
   * In-place batch addition G_i += H_i of affine points, i < n, where `pairs`
   * holds n pointer pairs (G_i, H_i). Uses one inversion.
   *
   * Unsafe: assumes no point is zero and G_i != +-H_i, which holds with
   * overwhelming probability for independent random inputs.
   *
   * scratch: 12 field elements
   */
  const batchAddUnsafe = func(
    {
      in: [{ scratch: i32 }, { pairs: i32 }, { n: i32 }],
      locals: { ...locals, g: i32, h: i32, i: i32, inv: i32 },
      out: [],
    },
    ({ scratch, pairs, n }, L) => {
      let { g, h, i, inv } = L;
      // formula elements first, then the inversion's input, output and scratch
      let f = context(L, scratch, 7);
      local.set(inv, i32.add(scratch, 7 * S));
      let loadPair = () => {
        local.set(h, i32.add(pairs, i32.shl(i, 3)));
        local.set(g, i32.load({}, h));
        local.set(h, i32.load({ offset: 4 }, h));
      };
      let ACC = f.element();
      let DX = f.element();
      let M = f.element();

      i32.eqz(n);
      if_(null, () => return_());
      // y1_i := (y2_i - y1_i) prod_{j<i} dx_j, ACC = prod_{j<=i} dx_j
      local.set(i, 0);
      block(null, (done) => {
        loop(null, (next) => {
          i32.ge_u(i, n);
          br_if(done);
          loadPair();
          f.subtractLoose(M, f.input(h, S), f.input(g, S));
          f.subtractLoose(DX, f.input(h), f.input(g));
          i32.eqz(i);
          if_(
            null,
            () => {
              f.store(g, S, M);
              f.copy(ACC, DX);
            },
            () => {
              f.multiply(M, ACC, M);
              f.store(g, S, M);
              f.multiply(ACC, ACC, DX);
            }
          );
          local.set(i, i32.add(i, 1));
          br(next);
        });
      });
      // ACC = prod_j dx_j^-1
      f.store(inv, 0, ACC);
      call(inverse, {
        scratch: i32.add(inv, 2 * S),
        r: i32.add(inv, S),
        a: inv,
      });
      f.load(ACC, inv, S);
      // walk back: m_i = y1_i ACC, add, ACC *= dx_i
      block(null, (done) => {
        loop(null, (next) => {
          local.set(i, i32.sub(i, 1));
          loadPair();
          f.subtractLoose(DX, f.input(h), f.input(g));
          f.load(M, g, S);
          f.multiply(M, M, ACC);
          addAffineGivenSlope(f, g, g, h, M);
          i32.eqz(i);
          br_if(done);
          f.multiply(ACC, ACC, DX);
          br(next);
        });
      });
    }
  );

  /**
   * Like {@link batchAddUnsafe}, but handles zero points and G_i = +-H_i.
   * Equal points are doubled within the same batch inversion.
   *
   * scratch: 4 field elements; tmp, d: n field elements each; kinds: n bytes
   */
  const batchAdd = func(
    {
      in: [
        { scratch: i32 },
        { tmp: i32 },
        { d: i32 },
        { kinds: i32 },
        { pairs: i32 },
        { n: i32 },
      ],
      locals: { g: i32, h: i32, i: i32, j: i32, kind: i32 },
      out: [],
    },
    ({ scratch, tmp, d, kinds, pairs, n }, { g, h, i, j, kind }) => {
      const loadPair = () => {
        local.set(h, i32.add(pairs, i32.shl(i, 3)));
        local.set(g, i32.load({}, h));
        local.set(h, i32.load({ offset: 4 }, h));
      };
      const y = (p: Local<"i32">) => i32.add(p, S);
      const isZero = (p: Local<"i32">) =>
        i32.eqz(i32.load8_u({ offset: 2 * S }, p));
      const tmpJ = () => i32.add(tmp, i32.mul(j, S));
      const dJ = () => i32.add(d, i32.mul(j, S));
      // kinds: 0 = nothing to do, 1 = add, 2 = double
      local.set(i, 0);
      local.set(j, 0);
      block(null, (done) => {
        loop(null, (next) => {
          i32.ge_u(i, n);
          br_if(done);
          loadPair();
          local.set(kind, 0);
          block(null, (classified) => {
            isZero(g);
            if_(null, () => {
              copyBytes(g, h, 2 * S + 1);
              br(classified);
            });
            isZero(h);
            br_if(classified);
            call(Field.reduce, { x: g });
            call(Field.reduce, { x: h });
            call(Field.isEqual, { x: g, y: h });
            if_(
              null,
              () => {
                call(Field.reduce, { x: y(g) });
                call(Field.reduce, { x: y(h) });
                call(Field.isEqual, { x: y(g), y: y(h) });
                if_(
                  null,
                  () => {
                    call(Field.add, { out: tmpJ(), x: y(g), y: y(g) });
                    local.set(kind, 2);
                  },
                  // G = -H
                  () => i32.store8({ offset: 2 * S }, g, 0)
                );
              },
              () => {
                call(Field.subtractPositive, { out: tmpJ(), x: h, y: g });
                local.set(kind, 1);
              }
            );
          });
          i32.store8({}, i32.add(kinds, i), kind);
          local.set(j, i32.add(j, i32.ne(kind, 0)));
          local.set(i, i32.add(i, 1));
          br(next);
        });
      });
      call(Field.batchInverse, { scratch, z: d, x: tmp, $n: j });
      local.set(i, 0);
      local.set(j, 0);
      block(null, (done) => {
        loop(null, (next) => {
          i32.ge_u(i, n);
          br_if(done);
          local.set(kind, i32.load8_u({}, i32.add(kinds, i)));
          loadPair();
          i32.eq(kind, 1);
          if_(null, () =>
            call(addAffine, { scratch, x3: g, x1: g, x2: h, d: dJ() })
          );
          i32.eq(kind, 2);
          if_(null, () =>
            call(doubleAffine, { scratch, xOut: g, x: g, d: dJ() })
          );
          local.set(j, i32.add(j, i32.ne(kind, 0)));
          local.set(i, i32.add(i, 1));
          br(next);
        });
      });
    }
  );

  const betaPtr = implicitMemory.dataToOffset(
    Field.bigintToData(mod(beta * Field.R, Field.p))
  );
  const endomorphism = func(
    {
      in: [{ xOut: i32 }, { x: i32 }],
      locals: { yOut: i32, y: i32 },
      out: [],
    },
    ({ xOut, x }, { yOut, y }) => {
      local.set(y, i32.add(x, S));
      local.set(yOut, i32.add(xOut, S));
      // x_out = x * beta, y_out = y
      call(Field.multiply, { xy: xOut, x, y: betaPtr });
      Field.copyInline(yOut, y);
    }
  );

  // projective (short Weierstrass, a = 0)

  const isZeroProjective = (p: Local<"i32">) =>
    i32.eqz(i32.load8_u({ offset: 3 * S }, p));
  const setNonZeroProjective = (p: Local<"i32">, nonZero: 0 | 1) =>
    i32.store8({ offset: 3 * S }, p, nonZero);

  /**
   * projective doubling P3 = 2 P1. P3 may alias P1.
   * scratch: 8 field elements
   */
  const doubleProjective = func(
    { in: [{ scratch: i32 }, { p3: i32 }, { p1: i32 }], locals, out: [] },
    ({ scratch, p3, p1 }, L) => {
      isZeroProjective(p1);
      if_(null, () => {
        setNonZeroProjective(p3, 0);
        return_();
      });
      setNonZeroProjective(p3, 1);
      let f = context(L, scratch, 8);
      let X1 = f.input(p1);
      let Y1 = f.input(p1, S);
      let Z1 = f.input(p1, 2 * S);
      let [tmp, w, s, ss, sss, Rx2, Bx4, h] = Array.from({ length: 8 }, () =>
        f.element()
      );
      let X3 = f.output(p3);
      let Y3 = f.output(p3, S);
      let Z3 = f.output(p3, 2 * S);
      // http://www.hyperelliptic.org/EFD/g1p/auto-shortw-projective.html#doubling-dbl-1998-cmo-2
      // w = 3 X1^2
      f.square(w, X1);
      f.add(tmp, w, w);
      f.add(w, tmp, w);
      // s = Y1 Z1, ss = s^2, sss = s^3
      f.multiply(s, Y1, Z1);
      f.square(ss, s);
      f.multiply(sss, ss, s);
      // Rx2 = 2 Y1 s
      f.multiply(Rx2, Y1, s);
      f.add(Rx2, Rx2, Rx2);
      // Bx4 = 2 X1 Rx2 = 4B
      f.multiply(Bx4, X1, Rx2);
      f.add(Bx4, Bx4, Bx4);
      // h = w^2 - 8B
      f.square(h, w);
      f.subtract(h, h, Bx4);
      f.subtract(h, h, Bx4);
      // X3 = 2 h s
      f.multiply(X3, h, s);
      f.add(X3, X3, X3);
      // Y3 = (4B - h) w - 2 Rx2^2
      f.subtract(Y3, Bx4, h);
      f.multiply(Y3, Y3, w);
      f.square(tmp, Rx2);
      f.add(tmp, tmp, tmp);
      f.subtract(Y3, Y3, tmp);
      // Z3 = 8 sss
      f.add(Z3, sss, sss);
      f.add(Z3, Z3, Z3);
      f.add(Z3, Z3, Z3);
      f.commit(X3, Y3, Z3);
    }
  );

  /**
   * projective addition or subtraction P3 = P1 +- P2, with Z2 = 1 if mixed.
   * P3 may alias P1. Handles zero and equal inputs.
   * scratch: 11 field elements
   */
  function projectiveAddition({
    isSubtract,
    isMixed,
  }: {
    isSubtract: boolean;
    isMixed: boolean;
  }) {
    return func(
      {
        in: [{ scratch: i32 }, { p3: i32 }, { p1: i32 }, { p2: i32 }],
        locals: { ...locals, y3: i32 },
        out: [],
      },
      ({ scratch, p3, p1, p2 }, L) => {
        let { y3 } = L;
        isZeroProjective(p1);
        if_(null, () => {
          copyBytes(p3, p2, 3 * S + 1);
          if (isSubtract) {
            local.set(y3, i32.add(p3, S));
            call(Field.subtract, { out: y3, x: formulas.zeroPtr, y: y3 });
          }
          return_();
        });
        isZeroProjective(p2);
        if_(null, () => {
          copyBytes(p3, p1, 3 * S + 1);
          return_();
        });

        let f = context(L, scratch, 11);
        let X1 = f.input(p1);
        let Y1 = f.input(p1, S);
        let Z1 = f.input(p1, 2 * S);
        let X2 = f.input(p2);
        let Y2 = f.input(p2, S);
        let Z2 = isMixed ? undefined : f.input(p2, 2 * S);
        let [Y2Z1, Y1Z2, X2Z1, X1Z2, Z1Z2, u, uu, v, vv, vvv, R] = Array.from(
          { length: 11 },
          () => f.element()
        );
        if (isSubtract) {
          f.negate(u, Y2);
          Y2 = u;
        }
        // http://www.hyperelliptic.org/EFD/g1p/auto-shortw-projective.html#addition-add-1998-cmo-2
        if (Z2 === undefined) f.copy(Y1Z2, Y1);
        else f.multiply(Y1Z2, Y1, Z2);
        f.multiply(Y2Z1, Y2, Z1);
        if (Z2 === undefined) f.copy(X1Z2, X1);
        else f.multiply(X1Z2, X1, Z2);
        f.multiply(X2Z1, X2, Z1);

        // x1 z2 = x2 z1 and y1 z2 = y2 z1 <==> P1 = P2: double; P1 = -P2: zero
        f.reduce(X1Z2);
        f.reduce(X2Z1);
        f.isEqual(X1Z2, X2Z1);
        if_(null, () => {
          f.reduce(Y1Z2);
          f.reduce(Y2Z1);
          f.isEqual(Y1Z2, Y2Z1);
          if_(
            null,
            () => call(doubleProjective, { scratch, p3, p1 }),
            () => setNonZeroProjective(p3, 0)
          );
          return_();
        });
        setNonZeroProjective(p3, 1);

        if (Z2 === undefined) f.copy(Z1Z2, Z1);
        else f.multiply(Z1Z2, Z1, Z2);
        let X3 = f.output(p3);
        let Y3 = f.output(p3, S);
        let Z3 = f.output(p3, 2 * S);
        // u = Y2Z1 - Y1Z2, uu = u^2
        f.subtract(u, Y2Z1, Y1Z2);
        f.square(uu, u);
        // v = X2Z1 - X1Z2, vv = v^2, vvv = v^3
        f.subtract(v, X2Z1, X1Z2);
        f.square(vv, v);
        f.multiply(vvv, v, vv);
        // R = vv X1Z2
        f.multiply(R, vv, X1Z2);
        // A = uu Z1Z2 - vvv - 2R
        let A = uu;
        f.multiply(A, uu, Z1Z2);
        f.subtract(A, A, vvv);
        f.subtract(A, A, R);
        f.subtract(A, A, R);
        // X3 = v A
        f.multiply(X3, v, A);
        // Y3 = u (R - A) - vvv Y1Z2
        f.subtract(R, R, A);
        f.multiply(Y3, u, R);
        f.multiply(Y1Z2, vvv, Y1Z2);
        f.subtract(Y3, Y3, Y1Z2);
        // Z3 = vvv Z1Z2
        f.multiply(Z3, vvv, Z1Z2);
        f.commit(X3, Y3, Z3);
      }
    );
  }

  // twisted Edwards, extended coordinates

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
        locals,
        out: [],
      },
      ({ scratch, p3, p1, p2, k }, L) => {
        let f = context(L, scratch, 9);
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
        locals,
        out: [],
      },
      ({ scratch, p3, p1, p2, k }, L) => {
        let f = context(L, scratch, 9);
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
        // C = 2 Z1 T2. Reducing additions keep F and H below 2p, so that one
        // reduction makes them canonical for the zero check.
        f.add(tmp, T2, T2);
        if (isSubtract) f.negate(tmp, tmp);
        f.multiply(C, Z1, tmp);
        // D = 2 T1 Z2
        f.add(D, T1, T1);
        if (Z2 !== undefined) f.multiply(D, D, Z2);
        // F = B - A, H = D - C; both zero iff the formula degenerates
        f.subtract(F, B, A);
        f.subtract(H, D, C);
        f.reduce(F);
        f.reduce(H);
        let zero = f.input(formulas.zeroPtr);
        f.isEqual(F, zero);
        f.isEqual(H, zero);
        i32.and();
        if_(null, () => {
          call(unified, { scratch, p3, p1, p2, k });
          return_();
        });
        // E = D + C, G = B + A
        f.addLoose(E, D, C);
        f.addLoose(G, B, A);
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
    sub: edwardsAddition({ isSubtract: true, isMixed: false }),
    addMixed: edwardsAddition({ isSubtract: false, isMixed: true }),
    subMixed: edwardsAddition({ isSubtract: true, isMixed: true }),
  };

  return {
    addAffine,
    doubleAffine,
    batchAdd,
    batchAddUnsafe,
    endomorphism,
    doubleProjective,
    addProjective: projectiveAddition({ isSubtract: false, isMixed: false }),
    subProjective: projectiveAddition({ isSubtract: true, isMixed: false }),
    addMixedProjective: projectiveAddition({
      isSubtract: false,
      isMixed: true,
    }),
    subMixedProjective: projectiveAddition({ isSubtract: true, isMixed: true }),
    addEdwards: edwardsDedicatedAddition({
      isSubtract: false,
      isMixed: false,
      unified: unifiedEdwards.add,
    }),
    subEdwards: edwardsDedicatedAddition({
      isSubtract: true,
      isMixed: false,
      unified: unifiedEdwards.sub,
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
