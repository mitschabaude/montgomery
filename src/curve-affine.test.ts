import { test } from "node:test";
import assert from "node:assert/strict";
import { Weierstraß, CurveParams } from "./index.ts";

for (let backend of ["29-bit", "auto"] as const) {
  test(`affine add and negate (${backend})`, async () => {
    let { Affine, Field, Bigint } = await Weierstraß.create(
      CurveParams.pallas,
      { backend }
    );
    let B = Bigint.Affine;
    let [g1, g2, g3] = Field.local.getPointers(3, Affine.size);
    let add = (P: any, Q: any, alias?: "G1" | "G2") => {
      Affine.writeBigint(g1, P);
      Affine.writeBigint(g2, Q);
      let out = alias === "G1" ? g1 : alias === "G2" ? g2 : g3;
      Affine.add(out, g1, g2);
      return Affine.toBigint(out);
    };
    let zero = { x: 0n, y: 1n, isZero: true };

    for (let i = 0; i < 20; i++) {
      let P = B.random();
      let Q = B.random();
      assert.deepEqual(add(P, Q), B.add(P, Q), "P + Q");
      assert.deepEqual(add(P, Q, "G1"), B.add(P, Q), "P + Q into P");
      assert.deepEqual(add(P, Q, "G2"), B.add(P, Q), "P + Q into Q");
      assert.deepEqual(add(P, P), B.double(P), "P + P");
      assert(add(P, B.negate(P)).isZero, "P - P");
      assert.deepEqual(add(zero, P), P, "0 + P");
      assert.deepEqual(add(P, zero), P, "P + 0");

      Affine.writeBigint(g1, P);
      Affine.negate(g2, g1);
      assert.deepEqual(Affine.toBigint(g2), B.negate(P), "-P");
      Affine.negate(g1, g1);
      assert.deepEqual(Affine.toBigint(g1), B.negate(P), "-P in place");
    }
  });
}
