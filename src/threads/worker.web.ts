// import type { MessagePort } from "node:worker_threads";

export { WebWorker as Worker, parentPort, availableParallelism };

let parentPort: Pick<
  Window,
  "addEventListener" | "removeEventListener" | "postMessage"
> = self;

const WebWorker = Worker;

function availableParallelism() {
  return navigator.hardwareConcurrency;
}
