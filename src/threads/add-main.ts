import { ThreadPool, parallelize } from "./threads.js";
import { add, mul } from "./add.js";

let src = "./add.js";
let pool = ThreadPool.create(new URL(src, import.meta.url));
let pAdd = parallelize(add, pool);
let pMul = parallelize(mul, pool);

let result = await pAdd.add(1, 2);
console.log(result);

result = await pMul.mul(10, 5);
console.log(result);

await pool.destroy();
