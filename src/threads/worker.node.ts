import {
  Worker as NodeWorker,
  parentPort as nodeParentPort,
} from "node:worker_threads";
import { availableParallelism } from "node:os";
import {
  WorkerConstructor,
  fromNodeTarget,
  fromNodeWorker,
} from "./simple-worker.js";

export { Worker, getParentPort, availableParallelism };

const Worker: WorkerConstructor = <M>(url: URL, name?: string) => {
  let worker = new NodeWorker(url, { name });
  return fromNodeWorker<M>(worker);
};

function getParentPort<M>() {
  if (nodeParentPort === null) return undefined;
  return fromNodeTarget<M>(nodeParentPort);
}
