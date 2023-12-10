class WorkerPool {
  workers: Worker[];
  constructor(workers: Worker[]) {
    this.workers = workers;
  }

  static create(source: string, T: number) {
    const workers = [];
    for (let t = 0; t < T; t++) {
      let worker = new Worker(source);
      worker.postMessage({ type: "init", t, T });
      workers.push(worker);
    }
    return new WorkerPool(workers);
  }

  postMessage(message: any) {
    this.workers.forEach((worker) => worker.postMessage(message));
  }

  onmessage(callback: (message: any) => void) {
    this.workers.forEach((worker) => {
      worker.onmessage = callback;
    });
  }
}
