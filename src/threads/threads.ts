import { Worker, parentPort } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { assert } from "../util.js";
import { AnyFunction } from "../types.js";

export {
  t,
  T,
  t as thread,
  T as THREADS,
  isMain,
  expose,
  parallelize,
  ThreadPool,
};

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

function expose<T extends Record<string, AnyFunction> | AnyFunction>(api: T) {
  if (typeof api === "function") {
    functions.set(api.name, api);
    return;
  }
  for (let [funcName, func] of Object.entries(api)) {
    functions.set(funcName, func);
  }
}

type ToPromise<T> = T extends Promise<any> ? T : Promise<T>;

function parallelize<T extends Record<string, AnyFunction>>(
  threadPool: ThreadPool,
  api: T
): {
  [K in keyof T]: (...args: Parameters<T[K]>) => ToPromise<ReturnType<T[K]>>;
} {
  let parallelApi = {} as any;
  for (let [funcName, func] of Object.entries(api)) {
    parallelApi[funcName] = async (...args: Parameters<T[keyof T]>) => {
      let workersDone = threadPool.call(funcName, ...(args as any));
      let mainResult = func(...(args as any));
      let [result] = await Promise.all([mainResult, workersDone]);
      return result;
    };
  }
  return parallelApi;
}

class ThreadPool {
  source: URL | string;
  workers: Worker[];
  isRunning: boolean;

  constructor(source: URL | string, workers: Worker[]) {
    this.source = source;
    this.workers = workers;
    this.isRunning = workers.length > 0;
  }

  static createInactive(source: URL | string) {
    return new ThreadPool(source, []);
  }

  static create(source: URL | string, T_ = availableParallelism()) {
    let pool = ThreadPool.createInactive(source);
    pool.start(T_);
    return pool;
  }

  start(T_ = availableParallelism()) {
    assert(!this.isRunning, "ThreadPool is already running");
    assert(T_ > 0, "T must be greater than 0");
    T = T_;
    this.isRunning = true;
    const workers = [];
    for (let t = 1; t < T_; t++) {
      let worker = new Worker(this.source);
      worker.unref();
      worker.postMessage({ type: MessageType.INIT, t, T: T_ });
      workers.push(worker);
    }
    this.workers = workers;
  }

  stop() {
    T = 1;
    this.isRunning = false;
    let promises = this.workers.map((worker) => worker.terminate());
    this.workers = [];
    return Promise.all(promises);
  }

  call<T extends AnyFunction>(func: string | T, ...args: Parameters<T>) {
    let funcName = typeof func === "string" ? func : func.name;
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
    return Promise.all(promises);
  }
}
