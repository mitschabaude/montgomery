import { ThreadPool, parallelize, workerOnly } from "./threads.js";
import { add, createMul } from "./add.js";
import { p, beta } from "../concrete/pasta.params.js";
import { createFieldWasm } from "../field-msm.js";
const w = 29;

let { instance, wasmArtifacts } = await createFieldWasm(p, beta, w);

let src = "./add.js";
let pool = ThreadPool.createInactive(new URL(src, import.meta.url));

let Mul_ = await createMul(10, { p, w }, wasmArtifacts, instance);
let Mul = parallelize(pool, Mul_);

pool.start();
await workerOnly(pool, createMul)(10, { p, w }, wasmArtifacts);

let result = await Mul.mul(10);
console.log(result);

await pool.stop();
