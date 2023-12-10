import { ThreadPool, parallelize } from "./threads.js";
import { api } from "./add.js";

export { parallelApi as api };

let src = "./add.js";
let pool = ThreadPool.create(new URL(src, import.meta.url));
let parallelApi = parallelize(api, pool);

let result = await parallelApi.add(1, 2);
console.log(result);

result = await parallelApi.add(10, 5);
console.log(result);

await pool.destroy();
