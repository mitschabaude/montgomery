import { ThreadPool, parallelize } from "./threads.js";
import { add, createMul } from "./add.js";
import { Field } from "../concrete/pasta.js";

let src = "./add.js";
let pool = ThreadPool.create(new URL(src, import.meta.url));
let pAdd = parallelize(add, pool);
let pMul = parallelize({ createMul }, pool);

let result = await pAdd.add(1, 2);
console.log(result);

let Mul = parallelize(await pMul.createMul(10, Field.wasm), pool);
result = await Mul.mul(10);
console.log(result);

await pool.destroy();
