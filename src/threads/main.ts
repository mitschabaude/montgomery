import { Worker } from "worker_threads";
import { wrap } from "comlink";
import { default as nodeEndpoint } from "comlink/dist/esm/node-adapter.mjs";
import { WorkerApi } from "./worker.js";

const worker = new Worker(new URL("./worker.js", import.meta.url));
worker.unref();
const workerApi = wrap<WorkerApi>(nodeEndpoint(worker));

let c = await workerApi.add(1, 2);

console.log({ c });
