import { ThreadPool } from "./threads.js";
import { createTest } from "./add.js";
import { p, beta } from "../concrete/pasta.params.js";
import { createFieldWasm } from "../field-msm.js";
const w = 29;

let { instance, wasmArtifacts } = await createFieldWasm(p, beta, w);
let src = "./add.js";
let pool = ThreadPool.createInactive(new URL(src, import.meta.url));
let Test0 = await createTest(10, { p, w }, wasmArtifacts, instance);
let Test = pool.parallelize(Test0);

await Test.log("hey");

await startThreads(5);
await Test.log("next");
await stopThreads();

await Test.log("alone");

await startThreads(4);
await Test.log("four times");
await stopThreads();

async function startThreads(n: number) {
  console.log(`starting ${n} workers`);
  pool.start(n);
  await pool.call(createTest, 10, { p, w }, wasmArtifacts);
}

async function stopThreads() {
  await pool.stop();
}
