import { Worker, parentPort } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { assert } from "../util.js";
import { AnyFunction } from "../types.js";

export { t, T, t as thread, T as THREADS, isMain, expose, ThreadPool };

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

let NAMESPACE = Symbol("namespace");

function expose<T extends Record<string, AnyFunction> | AnyFunction>(api: T): T;
function expose<T extends Record<string, any> | AnyFunction>(
  namespace: string,
  api: T
): T;
function expose<T extends Record<string, AnyFunction> | AnyFunction>(
  apiOrNamespace: T | string,
  maybeApi?: T
) {
  let namespace =
    typeof apiOrNamespace === "string" ? apiOrNamespace : undefined;
  let api = (
    typeof apiOrNamespace === "string" ? maybeApi : apiOrNamespace
  ) as T;
  (api as any)[NAMESPACE] = namespace;
  if (typeof api === "function") {
    functions.set(withNamespace(namespace, api.name), api);
    return api;
  }
  for (let [funcName, func] of Object.entries(api)) {
    if (typeof func !== "function") continue;
    functions.set(withNamespace(namespace, funcName), func);
  }
  return api;
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

  parallelize<T extends Record<string, any>>(
    api: T
  ): {
    [K in keyof T]: T[K] extends AnyFunction
      ? (...args: Parameters<T[K]>) => ToPromise<ReturnType<T[K]>>
      : never;
  } {
    let parallelApi = {} as any;
    for (let [funcName, func] of Object.entries(api)) {
      let calledName = withNamespace((api as any)[NAMESPACE], funcName);
      parallelApi[funcName] = async (...args: Parameters<T[keyof T]>) => {
        let workersDone = this.call(calledName, ...(args as any));
        let mainResult = func(...(args as any));
        let [result] = await Promise.all([mainResult, workersDone]);
        return result;
      };
    }
    return parallelApi;
  }

  call<T extends AnyFunction>(func: string | T, ...args: Parameters<T>) {
    let funcName =
      typeof func === "string"
        ? func
        : withNamespace((func as any)[NAMESPACE], func.name);
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

type ToPromise<T> = T extends Promise<any> ? T : Promise<T>;

function withNamespace(namespace: string | undefined, string: string) {
  if (namespace === undefined) return string;
  return `${namespace};${string}`;
}
