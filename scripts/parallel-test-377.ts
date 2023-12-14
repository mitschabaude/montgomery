import { create } from "../src/concrete/bls12-377.parallel.js";

const BLS12_377 = await create();
await BLS12_377.startThreads(4);

await BLS12_377.randomPointsFast(1000);

await BLS12_377.stopThreads();
