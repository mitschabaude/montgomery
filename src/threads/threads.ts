import { Worker, parentPort } from "worker_threads";
import { assert } from "../util.js";

export { t, T, expose, parallelize, ThreadPool };

let t = 0;
let T = 1;

enum MessageType {
  CALL,
  ANSWER,
  INIT,
}

type Message =
  | {
      type: MessageType.CALL;
      func: string;
      args: any[];
      callId: number;
    }
  | {
      type: MessageType.INIT;
      t: number;
      T: number;
    }
  | {
      type: MessageType.ANSWER;
      callId: number;
      result: any;
    };

const functions = new Map<string, (...args: any) => any>();

parentPort?.on("message", (message: Message) => {
  if (message.type === MessageType.CALL) {
    let { func: funcName, args, callId } = message;

    let func = functions.get(funcName);
    if (func === undefined) {
      throw Error(`Method ${message.func} not registered`);
    }

    let result = func(...args);
    parentPort?.postMessage({ type: MessageType.ANSWER, callId, result });
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

function parallelize<T extends Record<string, (...args: any) => any>>(
  api: T,
  threadPool: ThreadPool
): {
  [K in keyof T]: (...args: Parameters<T[K]>) => Promise<ReturnType<T[K]>[]>;
} {
  let parallelApi = {} as any;
  for (let [funcName, func] of Object.entries(api)) {
    parallelApi[funcName] = async (...args: Parameters<T[keyof T]>) => {
      let workerResults = threadPool.call(funcName, args);
      let result = func(...(args as any));
      let results = await workerResults;
      return [result, ...results];
    };
  }
  return parallelApi;
}

class ThreadPool {
  workers: Worker[];
  constructor(workers: Worker[]) {
    this.workers = workers;
  }

  static create(T_: number, source: URL | string) {
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

  call<T extends Record<string, (...args: any) => any>>(
    funcName: keyof T,
    args: Parameters<T[keyof T]>
  ) {
    let promises = this.workers.map((worker) => {
      return new Promise((resolve, reject) => {
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
            resolve(message.result);
          }
        });
      });
    });
    return Promise.all(promises);
  }
}
