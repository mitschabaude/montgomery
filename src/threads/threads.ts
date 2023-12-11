import { Worker, parentPort } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { assert } from "../util.js";

export { t, T, isMain, expose, parallelize, ThreadPool };

let t = 0;
let T = 1;

function isMain() {
  return t === 0;
}

enum MessageType {
  CALL,
  ANSWER,
  INIT,
}

type Message =
  | { type: MessageType.CALL; func: string; args: any[]; callId: number }
  | { type: MessageType.INIT; t: number; T: number }
  | { type: MessageType.ANSWER; callId: number; result: any };

const functions = new Map<string, (...args: any) => any>();

parentPort?.on("message", async (message: Message) => {
  if (message.type === MessageType.CALL) {
    let { func: funcName, args, callId } = message;

    let func = functions.get(funcName);
    if (func === undefined) {
      throw Error(`Method ${message.func} not registered`);
    }

    await func(...args);
    parentPort?.postMessage({ type: MessageType.ANSWER, callId });
  } else if (message.type === MessageType.INIT) {
    t = message.t;
    T = message.T;
  }
});

function expose<T extends Record<string, (...args: any) => any>>(api: T) {
  for (let [funcName, func] of Object.entries(api)) {
    functions.set(funcName, func);
  }
}

type ToPromise<T> = T extends Promise<any> ? T : Promise<T>;

function parallelize<T extends Record<string, (...args: any) => any>>(
  api: T,
  threadPool: ThreadPool
): {
  [K in keyof T]: (...args: Parameters<T[K]>) => ToPromise<ReturnType<T[K]>>;
} {
  let parallelApi = {} as any;
  for (let [funcName, func] of Object.entries(api)) {
    parallelApi[funcName] = async (...args: Parameters<T[keyof T]>) => {
      let workerResults = threadPool.call(funcName, args);
      let mainResult = func(...(args as any));
      let [result] = await Promise.all([mainResult, ...workerResults]);
      return result;
    };
  }
  return parallelApi;
}

class ThreadPool {
  workers: Worker[];
  isAlive = true;

  constructor(workers: Worker[]) {
    this.workers = workers;
  }

  static create(source: URL | string, T_ = availableParallelism()) {
    assert(T_ > 0, "T must be greater than 0");
    T = T_;
    const workers = [];
    for (let t = 1; t < T_; t++) {
      let worker = new Worker(source);
      worker.unref();
      worker.postMessage({ type: MessageType.INIT, t, T: T_ });
      workers.push(worker);
    }
    return new ThreadPool(workers);
  }

  destroy() {
    this.isAlive = false;
    return Promise.all(this.workers.map((worker) => worker.terminate()));
  }

  call<T extends Record<string, (...args: any) => any>>(
    funcName: keyof T,
    args: Parameters<T[keyof T]>
  ) {
    assert(this.isAlive, "ThreadPool is destroyed");

    let promises = this.workers.map((worker) => {
      return new Promise<void>((resolve, reject) => {
        let callId = Math.random();
        worker.postMessage({
          type: MessageType.CALL,
          func: funcName,
          args,
          callId,
        });
        worker.once("message", (message: Message) => {
          if (
            message.type === MessageType.ANSWER &&
            message.callId === callId
          ) {
            resolve();
          }
        });
      });
    });
    return promises;
  }
}
