import { create } from "../src/concrete/bls12-377.parallel.js";
import { tic, toc } from "../src/extra/tictoc.js";

const BLS12_377 = await create();

let n = Number(process.argv[3] ?? 16);
let N = 1 << n;

let nThreads = Number(process.argv[4] ?? 16);
await BLS12_377.startThreads(nThreads);

tic("random points");
let points = await BLS12_377.randomPointsFast(N);
toc();

await BLS12_377.stopThreads();

tic("check points");
let scratch = BLS12_377.Field.getPointers(5);
points.forEach((gPtr) => {
  BLS12_377.Affine.assertOnCurve(scratch, gPtr);
});
toc();
