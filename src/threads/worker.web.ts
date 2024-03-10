import {
  WorkerConstructor,
  fromWebTarget,
  fromWebWorker,
} from "./simple-worker.js";

export { Worker_ as Worker, getParentPort, availableParallelism };

const Worker_: WorkerConstructor = <M>(url: URL, name?: string) => {
  let worker = new Worker(url, { type: "module", name });
  return fromWebWorker<M>(worker);
};

declare let WorkerGlobalScope: Function | undefined;

function isInWebWorker() {
  return (
    typeof WorkerGlobalScope !== "undefined" &&
    self instanceof WorkerGlobalScope
  );
}

function getParentPort<M>() {
  if (isInWebWorker()) {
    return fromWebTarget<M>(self);
  }
}

function availableParallelism() {
  return navigator.hardwareConcurrency;
}
