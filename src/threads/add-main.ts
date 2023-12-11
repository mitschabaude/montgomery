import { ThreadPool, parallelize } from "./threads.js";
import { add, createMul } from "./add.js";
import { p, beta } from "../concrete/pasta.params.js";
import { createFieldWasm } from "../field-msm.js";
const w = 29;

let { wasmArtifacts } = await createFieldWasm(p, beta, w);

let src = "./add.js";
let pool = ThreadPool.create(new URL(src, import.meta.url));
console.log({ pool });
let pAdd = parallelize(add, pool);
let pMul = parallelize({ createMul }, pool);

let result = await pAdd.add(1, 2);
console.log(result);

let Mul_ = await pMul.createMul(10, { p, w }, wasmArtifacts);
let Mul = parallelize(Mul_, pool);
result = await Mul.mul(10);
console.log(result);

await pool.destroy();
