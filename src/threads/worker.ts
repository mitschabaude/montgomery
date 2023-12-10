import { expose } from "comlink";
import nodeEndpoint from "comlink/dist/esm/node-adapter.mjs";
import { parentPort } from "worker_threads";

export type { WorkerApi };

const worker = {
  add: (a: number, b: number) => a + b,
};

type WorkerApi = typeof worker;

expose(worker, nodeEndpoint(parentPort as any));
