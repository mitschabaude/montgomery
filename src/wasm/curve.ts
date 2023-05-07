// import type * as W from "wasmati"; // for type names
import {
  call,
  func,
  i32,
  local,
  if_,
  return_,
  Func,
  loop,
  br_if,
} from "wasmati";
import { FieldWithMultiply } from "./multiply-montgomery.js";
import { mod } from "../ff-util.js";
import { ImplicitMemory } from "./wasm-util.js";

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
  inverse: Func<[i32, i32, i32], []>,
  beta: bigint
) {
  const addAffine = func(
    { in: [i32, i32, i32, i32, i32], locals: [i32, i32, i32, i32], out: [] },
    ([m, x3, x1, x2, d], [y3, y1, y2, tmp]) => {
      // compute other pointers from inputs
      local.set(y1, i32.add(x1, Field.size));
      local.set(y2, i32.add(x2, Field.size));
      local.set(y3, i32.add(x3, Field.size));
      local.set(tmp, i32.add(m, Field.size));

      // mark output point as non-zero
      i32.store8({ offset: 2 * Field.size }, x3, 1);

      // m = (y2 - y1)*d
      call(Field.subtractPositive, [m, y2, y1]);
      call(Field.multiply, [m, m, d]);

      // x3 = m^2 - x1 - x2
      call(Field.square, [tmp, m]);
      call(Field.subtract, [x3, tmp, x1]);
      call(Field.subtract, [x3, x3, x2]);

      // y3 = (x2 - x3)*m - y2
      call(Field.subtractPositive, [y3, x2, x3]);
      call(Field.multiply, [y3, y3, m]);
      call(Field.subtract, [y3, y3, y2]);
    }
  );

  const { R, p } = Field;
  const betaMontgomery = mod(beta * R, p);
  const betaGlobal = implicitMemory.data(Field.bigintToData(betaMontgomery));

  const endomorphism = func(
    { in: [i32, i32], locals: [i32, i32], out: [] },
    ([xOut, x], [yOut, y]) => {
      // compute other pointers from inputs
      local.set(y, i32.add(x, Field.size));
      local.set(yOut, i32.add(xOut, Field.size));

      // x_out = x * beta
      call(Field.multiply, [xOut, x, betaGlobal]);

      // y_out = y
      Field.copyInline(yOut, y);
    }
  );

  const batchAddUnsafe = func(
    {
      in: [i32, i32, i32, i32, i32, i32, i32],
      locals: [i32, i32, i32, i32],
      out: [],
    },
    ([scratch, d, x, S, G, H, $n], [$i, $j, I, $N]) => {
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
        call(Field.subtractPositive, [x, i32.load({}, H), i32.load({}, G)]);
        call(inverse, [scratch, d, x]),
          call(addAffine, [
            scratch,
            i32.load({}, S),
            i32.load({}, G),
            i32.load({}, H),
            d,
          ]),
          return_();
      });

      // create products di = x0*...*xi, where xi = Hi_x - Gi_x
      call(Field.subtractPositive, [x, i32.load({}, H), i32.load({}, G)]);
      call(Field.subtractPositive, [
        i32.add(x, Field.size),
        i32.load({ offset: 4 }, H),
        i32.load({ offset: 4 }, G),
      ]);
      call(Field.multiply, [i32.add(d, Field.size), i32.add(x, Field.size), x]);
      i32.eq($n, 2);
      if_(null, () => {
        call(inverse, [scratch, I, i32.add(d, Field.size)]);
        call(Field.multiply, [i32.add(d, Field.size), x, I]);
        call(addAffine, [
          scratch,
          i32.load({ offset: 4 }, S),
          i32.load({ offset: 4 }, G),
          i32.load({ offset: 4 }, H),
          i32.add(d, Field.size),
        ]);
        call(Field.multiply, [d, i32.add(x, Field.size), I]);
        call(addAffine, [
          scratch,
          i32.load({}, S),
          i32.load({}, G),
          i32.load({}, H),
          d,
        ]);
        return_();
      });
      local.set($i, i32.const(2 * Field.size));
      local.set($j, i32.const(2 * 4));
      loop(null, () => {
        call(Field.subtractPositive, [
          i32.add(x, $i),
          i32.load({}, i32.add(H, $j)),
          i32.load({}, i32.add(G, $j)),
        ]);
        call(Field.multiply, [
          i32.add(d, $i),
          i32.add(d, i32.sub($i, Field.size)),
          i32.add(x, $i),
        ]);
        local.set($j, i32.add($j, 4));
        i32.ne($N, local.tee($i, i32.add($i, Field.size)));
        br_if(0);
      });
      // inverse I = 1/(x0*...*x(n-1))
      call(inverse, [scratch, I, i32.add(d, i32.sub($N, Field.size))]);
      // create inverses 1/x(n-1), ..., 1/x2
      local.set($i, i32.sub($N, Field.size));
      local.set($j, i32.sub($j, 4));
      loop(null, () => {
        call(Field.multiply, [
          i32.add(d, $i),
          i32.add(d, i32.sub($i, Field.size)),
          I,
        ]);
        call(addAffine, [
          scratch,
          i32.load({}, i32.add(S, $j)),
          i32.load({}, i32.add(G, $j)),
          i32.load({}, i32.add(H, $j)),
          i32.add(d, $i),
        ]);
        call(Field.multiply, [I, I, i32.add(x, $i)]);
        local.set($j, i32.sub($j, 4));
        i32.ne(Field.size, local.tee($i, i32.sub($i, Field.size)));
        br_if(0);
      });
      // 1/x1, 1/x0
      call(Field.multiply, [i32.add(d, Field.size), x, I]);
      call(addAffine, [
        scratch,
        i32.load({ offset: 4 }, S),
        i32.load({ offset: 4 }, G),
        i32.load({ offset: 4 }, H),
        i32.add(d, Field.size),
      ]);
      call(Field.multiply, [d, i32.add(x, Field.size), I]);
      call(addAffine, [
        scratch,
        i32.load({}, S),
        i32.load({}, G),
        i32.load({}, H),
        d,
      ]);
    }
  );

  return { addAffine, endomorphism, batchAddUnsafe };
}
