import { api } from "./worker.js";
import { ThreadPool, parallelize } from "./threads.js";

let moduleSrc = new URL("./worker.js", import.meta.url);
let pool = ThreadPool.create(4, moduleSrc);

let parallelApi = parallelize(api, pool);

let result = await parallelApi.add(1, 2);
console.log(result);

result = await parallelApi.add(10, 5);
console.log(result);
