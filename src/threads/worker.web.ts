export { WebWorker as Worker, parentPort, availableParallelism };

let parentPort: MessagePort | null = null;

function WebWorker(url: string) {
  // TODO should create a worker from an "inline file"
  return new Worker(url);
}

function availableParallelism() {
  return navigator.hardwareConcurrency;
}
