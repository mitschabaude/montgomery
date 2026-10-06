// import type * as W from "wasmati"; // for type names
import {
  call,
  func,
  i32,
  local,
  if_,
  return_,
  type Func,
  loop,
  br_if,
} from "wasmati";
import { type FieldWithMultiply } from "./multiply-montgomery.ts";
import { mod } from "../bigint/field-util.ts";
import { ImplicitMemory } from "./wasm-util.ts";

export { curveOps };

/**
 *
 * @param implicitMemory
 * @param Field
 * @param beta cube root in the base field for endomorphism
 * @returns
 */
function curveOps(
  implicitMemory: ImplicitMemory,
  Field: FieldWithMultiply,
  inverse: Func<[{ scratch: "i32" }, { r: "i32" }, { a: "i32" }], []>,
  beta: bigint
) {
  const addAffine = func(
    {
      in: [{ m: i32 }, { x3: i32 }, { x1: i32 }, { x2: i32 }, { d: i32 }],
      locals: { y3: i32, y1: i32, y2: i32, tmp: i32 },
      out: [],
    },
    ({ m, x3, x1, x2, d }, { y3, y1, y2, tmp }) => {
      // compute other pointers from inputs
      local.set(y1, i32.add(x1, Field.size));
      local.set(y2, i32.add(x2, Field.size));
      local.set(y3, i32.add(x3, Field.size));
      local.set(tmp, i32.add(m, Field.size));

      // mark output point as non-zero
      i32.store8({ offset: 2 * Field.size }, x3, 1);

      // m = (y2 - y1)*d
      call(Field.subtractPositive, { out: m, x: y2, y: y1 });
      call(Field.multiply, { xy: m, x: m, y: d });

      // x3 = m^2 - x1 - x2
      call(Field.square, { xy: tmp, x: m });
      call(Field.subtract, { out: x3, x: tmp, y: x1 });
      call(Field.subtract, { out: x3, x: x3, y: x2 });

      // y3 = (x2 - x3)*m - y2
      call(Field.subtractPositive, { out: y3, x: x2, y: x3 });
      call(Field.multiply, { xy: y3, x: y3, y: m });
      call(Field.subtract, { out: y3, x: y3, y: y2 });
    }
  );

  // version which receives m stored in y3
  // when add-assigning, y3 = y1; note that given m, we don't need y1
  // so we replace y1 AND d with m, which saves 1 stored field
  const addAffinePacked = func(
    {
      in: [{ tmp: i32 }, { x3: i32 }, { x1: i32 }, { x2: i32 }],
      locals: { y3: i32, y2: i32, unused2: i32 },
      out: [],
    },
    ({ tmp, x3, x1, x2 }, { y3, y2 }) => {
      // compute other pointers from inputs
      local.set(y2, i32.add(x2, Field.size));
      local.set(y3, i32.add(x3, Field.size));
      let m = y3;

      // mark output point as non-zero
      i32.store8({ offset: 2 * Field.size }, x3, 1);

      // x3 = m^2 - x1 - x2
      call(Field.square, { xy: tmp, x: m });
      call(Field.subtract, { out: x3, x: tmp, y: x1 });
      call(Field.subtract, { out: x3, x: x3, y: x2 });

      // y3 = (x2 - x3)*m - y2
      call(Field.subtractPositive, { out: tmp, x: x2, y: x3 });
      call(Field.multiply, { xy: y3, x: m, y: tmp }); // y3 = m is fine here
      call(Field.subtract, { out: y3, x: y3, y: y2 });
    }
  );

  const { R, p } = Field;
  const betaMontgomery = mod(beta * R, p);
  const betaGlobal = implicitMemory.data(Field.bigintToData(betaMontgomery));

  const endomorphism = func(
    {
      in: [{ xOut: i32 }, { x: i32 }],
      locals: { yOut: i32, y: i32 },
      out: [],
    },
    ({ xOut, x }, { yOut, y }) => {
      // compute other pointers from inputs
      local.set(y, i32.add(x, Field.size));
      local.set(yOut, i32.add(xOut, Field.size));

      // x_out = x * beta
      call(Field.multiply, { xy: xOut, x, y: betaGlobal });

      // y_out = y
      Field.copyInline(yOut, y);
    }
  );

  const batchAddUnsafe = func(
    {
      in: [
        { scratch: i32 },
        { d: i32 },
        { x: i32 },
        { S: i32 },
        { G: i32 },
        { H: i32 },
        { $n: i32 },
      ],
      locals: { $i: i32, $j: i32, I: i32, $N: i32 },
      out: [],
    },
    ({ scratch, d, x, S, G, H, $n }, { $i, $j, I, $N }) => {
      local.set(I, scratch);
      local.set(scratch, i32.add(scratch, Field.size));
      local.set($N, i32.mul($n, Field.size));
      // return early if n = 0 or 1
      i32.eqz($n);

      if_(null, () => {
        return_();
      });
      i32.eq($n, 1);
      if_(null, () => {
        call(Field.subtractPositive, {
          out: x,
          x: i32.load({}, H),
          y: i32.load({}, G),
        });
        call(inverse, { scratch, r: d, a: x }),
          call(addAffine, {
            m: scratch,
            x3: i32.load({}, S),
            x1: i32.load({}, G),
            x2: i32.load({}, H),
            d,
          }),
          return_();
      });

      // create products di = x0*...*xi, where xi = Hi_x - Gi_x
      call(Field.subtractPositive, {
        out: x,
        x: i32.load({}, H),
        y: i32.load({}, G),
      });
      call(Field.subtractPositive, {
        out: i32.add(x, Field.size),
        x: i32.load({ offset: 4 }, H),
        y: i32.load({ offset: 4 }, G),
      });
      call(Field.multiply, {
        xy: i32.add(d, Field.size),
        x: i32.add(x, Field.size),
        y: x,
      });
      i32.eq($n, 2);
      if_(null, () => {
        call(inverse, { scratch, r: I, a: i32.add(d, Field.size) });
        call(Field.multiply, { xy: i32.add(d, Field.size), x, y: I });
        call(addAffine, {
          m: scratch,
          x3: i32.load({ offset: 4 }, S),
          x1: i32.load({ offset: 4 }, G),
          x2: i32.load({ offset: 4 }, H),
          d: i32.add(d, Field.size),
        });
        call(Field.multiply, { xy: d, x: i32.add(x, Field.size), y: I });
        call(addAffine, {
          m: scratch,
          x3: i32.load({}, S),
          x1: i32.load({}, G),
          x2: i32.load({}, H),
          d,
        });
        return_();
      });
      local.set($i, i32.const(2 * Field.size));
      local.set($j, i32.const(2 * 4));
      loop(null, () => {
        call(Field.subtractPositive, {
          out: i32.add(x, $i),
          x: i32.load({}, i32.add(H, $j)),
          y: i32.load({}, i32.add(G, $j)),
        });
        call(Field.multiply, {
          xy: i32.add(d, $i),
          x: i32.add(d, i32.sub($i, Field.size)),
          y: i32.add(x, $i),
        });
        local.set($j, i32.add($j, 4));
        i32.ne($N, local.tee($i, i32.add($i, Field.size)));
        br_if(0);
      });
      // inverse I = 1/(x0*...*x(n-1))
      call(inverse, { scratch, r: I, a: i32.add(d, i32.sub($N, Field.size)) });
      // create inverses 1/x(n-1), ..., 1/x2
      local.set($i, i32.sub($N, Field.size));
      local.set($j, i32.sub($j, 4));
      loop(null, () => {
        call(Field.multiply, {
          xy: i32.add(d, $i),
          x: i32.add(d, i32.sub($i, Field.size)),
          y: I,
        });
        call(addAffine, {
          m: scratch,
          x3: i32.load({}, i32.add(S, $j)),
          x1: i32.load({}, i32.add(G, $j)),
          x2: i32.load({}, i32.add(H, $j)),
          d: i32.add(d, $i),
        });
        call(Field.multiply, { xy: I, x: I, y: i32.add(x, $i) });
        local.set($j, i32.sub($j, 4));
        i32.ne(Field.size, local.tee($i, i32.sub($i, Field.size)));
        br_if(0);
      });
      // 1/x1, 1/x0
      call(Field.multiply, { xy: i32.add(d, Field.size), x, y: I });
      call(addAffine, {
        m: scratch,
        x3: i32.load({ offset: 4 }, S),
        x1: i32.load({ offset: 4 }, G),
        x2: i32.load({ offset: 4 }, H),
        d: i32.add(d, Field.size),
      });
      call(Field.multiply, { xy: d, x: i32.add(x, Field.size), y: I });
      call(addAffine, {
        m: scratch,
        x3: i32.load({}, S),
        x1: i32.load({}, G),
        x2: i32.load({}, H),
        d,
      });
    }
  );

  return { addAffine, addAffinePacked, endomorphism, batchAddUnsafe };
}
