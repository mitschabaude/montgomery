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
  ThreadPool,
  setDebug,
  log,
};

let t = 0;
let T = 1;

function isMain() {
  return t === 0;
}
function log(...args: any) {
  console.log(`${t}:`, ...args);
}

let DEBUG = false;
function setDebug(debug: boolean) {
  DEBUG = debug;
}

enum MessageType {
  CALL = "call",
  ANSWER = "answer",
  INIT = "init",
}

type Message =
  | { type: MessageType.CALL; func: string; args: any[]; callId: number }
  | { type: MessageType.INIT; t: number; T: number }
  | { type: MessageType.ANSWER; callId: number; result: any };

const functions = new Map<string, (...args: any) => any>();

parentPort?.on("message", async (message: Message) => {
  if (DEBUG) console.log(`worker ${t}/${T} got message`, message);

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
    let exposedName = withNamespace(namespace, api.name);
    if (DEBUG) console.log(`exposing ${exposedName}`);
    functions.set(exposedName, api);
    return api;
  }
  for (let [funcName, func] of Object.entries(api)) {
    if (typeof func !== "function") continue;
    let exposedName = withNamespace(namespace, funcName);
    if (DEBUG) console.log(`exposing ${exposedName}`);
    functions.set(exposedName, func);
  }
  return api;
}

class ThreadPool {
  source: URL;
  workers: Worker[];
  isRunning: boolean;

  constructor(source: URL | string, workers: Worker[]) {
    this.source = typeof source === "string" ? new URL(source) : source;
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
      // TODO: do we want this?
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

  parallelize<T extends Record<string, any> | AnyFunction>(
    api: T
  ): Parallelized<T> {
    if (typeof api === "function") {
      let func = api as AnyFunction & T;
      let calledName = withNamespace((func as any)[NAMESPACE], func.name);
      return (async (...args: any) => {
        let workersDone = this.callWorkers(calledName, ...args);
        let mainResult = func(...args);
        let [result] = await Promise.all([mainResult, workersDone]);
        return result;
      }) as any;
    }
    let parallelApi = {} as any;
    for (let [funcName, func] of Object.entries(api)) {
      if (typeof func !== "function") {
        parallelApi[funcName] = func;
        continue;
      }
      let calledName = withNamespace((api as any)[NAMESPACE], funcName);
      parallelApi[funcName] = async (...args: any) => {
        let workersDone = this.callWorkers(calledName, ...args);
        let mainResult = func(...args);
        let [result] = await Promise.all([mainResult, workersDone]);
        return result;
      };
    }
    return parallelApi;
  }

  callWorkers<T extends AnyFunction>(func: string | T, ...args: Parameters<T>) {
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
        worker.on("message", function handler(message: Message) {
          if (
            message.type === MessageType.ANSWER &&
            message.callId === callId
          ) {
            worker.off("message", handler);
            resolve();
          }
        });
      });
    });
    return Promise.all(promises);
  }

  register<T extends Record<string, AnyFunction> | AnyFunction>(
    api: T
  ): Parallelized<T>;
  register<T extends Record<string, any> | AnyFunction>(
    namespace: string,
    api: T
  ): Parallelized<T>;
  register(apiOrNamespace: any, maybeApi?: any) {
    let api = expose(apiOrNamespace, maybeApi);
    if (isMain()) return this.parallelize(api);
    return api;
  }
}

type Parallelized<T> = T extends AnyFunction
  ? ToAsync<T>
  : {
      [K in keyof T]: ToAsync<T[K]>;
    };

type ToAsync<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => ToPromise<R>
  : T;

type ToPromise<T> = T extends Promise<any> ? T : Promise<T>;

function withNamespace(namespace: string | undefined, string: string) {
  if (namespace === undefined) return string;
  return `${namespace};${string}`;
}
