import { Worker, parentPort } from "node:worker_threads";
import { availableParallelism } from "node:os";

export { Worker, parentPort, availableParallelism };
