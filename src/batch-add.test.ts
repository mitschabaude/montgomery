/**
 * Test the Wasm batch-affine additions against the bigint implementation,
 * including zero, equal, opposite and aliased points.
 */
import { Weierstraß } from "./parallel.ts";
import { pallasParams } from "./concrete/pasta.params.ts";
import { curveParams as bls12377Params } from "./concrete/bls12-377.params.ts";
import { type CurveParams } from "./bigint/affine-weierstrass.ts";
import { assert } from "./util.ts";

for (let params of [pallasParams, bls12377Params]) {
  await testBatchAdd(params);
}

async function testBatchAdd(params: CurveParams) {
  const { Field, Affine, Bigint } = await Weierstraß.create(params);
  const B = Bigint.Affine;
  type Point = ReturnType<typeof B.random>;
  // the bigint doubling can't handle y = 0, where the sum is zero
  const add = (G: Point, H: Point) =>
    !G.isZero && G.y === 0n && !H.isZero && H.x === G.x ? B.zero : B.add(G, H);
  using _ = Field.local.atCurrentOffset;
  let scratch = Field.local.getPointers(14);
  let dx = Field.local.getPointer(128 * Field.sizeField);
  let P = B.random();
  let Q = B.random();
  let pairs: [Point, Point][] = [
    [P, Q],
    [P, { ...P }],
    [P, B.negate(P)],
    [B.zero, P],
    [P, B.zero],
    [B.zero, B.zero],
    [Q, P],
  ];
  // (-1, 0) has order 2 on curves y^2 = x^3 + 1
  if (params.b === 1n) {
    let T = { x: params.modulus - 1n, y: 0n, isZero: false };
    pairs.push([T, { ...T }]);
  }
  // pairs with different points, and pairs of one point at the same address
  let n = pairs.length;
  let points = Field.local.getPointers(2 * n, Affine.size);
  let aliased = Field.local.getPointers(n, Affine.size);
  let pairsPtr = Field.local.getPointer(8 * 2 * n);
  let view = new Uint32Array(Field.memoryBytes.buffer, pairsPtr, 4 * n);
  pairs.forEach(([G, H], i) => {
    Affine.writeBigint(points[2 * i], G);
    Affine.writeBigint(points[2 * i + 1], H);
    Affine.writeBigint(aliased[i], G);
    view.set([points[2 * i], points[2 * i + 1]], 2 * i);
    view.set([aliased[i], aliased[i]], 2 * (n + i));
  });
  let kinds = Field.local.getPointer(2 * n);
  Field.batchAdd(scratch[0], dx, kinds, pairsPtr, 2 * n);
  pairs.forEach(([G, H], i) => {
    let label = `${params.label}: batch add, pair ${i}`;
    let expected = add(G, H);
    assert(B.isEqual(Affine.toBigint(points[2 * i]), expected), label);
    let doubled = add(G, G);
    assert(
      B.isEqual(Affine.toBigint(aliased[i]), doubled),
      `${label}, aliased`
    );
  });

  // unsafe additions of independent random points
  let m = 64;
  let gs = Array.from({ length: m }, () => B.random());
  let hs = Array.from({ length: m }, () => B.random());
  let ptrs = Field.local.getPointers(2 * m, Affine.size);
  let unsafePairs = Field.local.getPointer(8 * m + 8);
  unsafePairs = Math.ceil(unsafePairs / 8) * 8;
  let unsafeView = new Uint32Array(
    Field.memoryBytes.buffer,
    unsafePairs,
    2 * m
  );
  for (let i = 0; i < m; i++) {
    Affine.writeBigint(ptrs[2 * i], gs[i]);
    Affine.writeBigint(ptrs[2 * i + 1], hs[i]);
    unsafeView.set([ptrs[2 * i], ptrs[2 * i + 1]], 2 * i);
  }
  Field.batchAddUnsafe(scratch[0], dx, unsafePairs, m);
  for (let i = 0; i < m; i++) {
    assert(
      B.isEqual(Affine.toBigint(ptrs[2 * i]), B.add(gs[i], hs[i])),
      `${params.label}: unsafe batch add, pair ${i}`
    );
  }
  console.log(`${params.label}: batch additions match bigint`);
}
