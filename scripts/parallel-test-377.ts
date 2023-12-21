import { create } from "../src/concrete/bls12-377.parallel.js";
import { tic, toc } from "../src/extra/tictoc.js";

const BLS12_377 = await create();

let nThreads = Number(process.argv[4] ?? 16);
await BLS12_377.startThreads(nThreads);

let n = Number(process.argv[3] ?? 20);

tic("random points");
console.log("");
await BLS12_377.randomPointsFast(1 << n, { entropy: 64, windowSize: 13 });
toc();

await BLS12_377.stopThreads();
