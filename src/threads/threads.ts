import { Worker, parentPort } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { assert } from "../util.js";
import { AnyFunction } from "../types.js";

export {
  thread as t,
  THREADS as T,
  thread,
  THREADS,
  isMain,
  expose,
  ThreadPool,
  setDebug,
  log,
  sharedArray,
  range,
  rangeMain,
  barrier,
  lock,
  unlock,
};

let thread = 0;
let THREADS = 1;

const SHARED_POINTERS = 2;

let sharedArray = new Int32Array(new SharedArrayBuffer(4 * SHARED_POINTERS));

function isMain() {
  return thread === 0;
}
function log(...args: any) {
  console.log(`${thread}:`, ...args);
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
  | {
      type: MessageType.INIT;
      thread: number;
      THREADS: number;
      sharedArray: ArrayBuffer;
    }
  | { type: MessageType.ANSWER; callId: number };

const functions = new Map<string, (...args: any) => any>();

parentPort?.on("message", async (message: Message) => {
  if (DEBUG) console.log(`worker ${thread}/${THREADS} got message`, message);

  if (message.type === MessageType.CALL) {
    let { func: funcName, args, callId } = message;

    let func = functions.get(funcName);
    if (func === undefined) {
      throw Error(`Method ${message.func} not registered`);
    }

    await func(...args);
    parentPort?.postMessage({ type: MessageType.ANSWER, callId });
  } else if (message.type === MessageType.INIT) {
    thread = message.thread;
    THREADS = message.THREADS;
    sharedArray = new Int32Array(message.sharedArray);
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

  start(T = availableParallelism()) {
    assert(!this.isRunning, "ThreadPool is already running");
    assert(T > 0, "T must be greater than 0");
    THREADS = T;
    sharedArray.fill(0);
    this.isRunning = true;
    const workers = [];
    for (let t = 1; t < T; t++) {
      let worker = new Worker(this.source);
      // TODO: do we want this?
      worker.unref();
      worker.postMessage({
        type: MessageType.INIT,
        thread: t,
        THREADS: T,
        sharedArray: sharedArray.buffer,
      } satisfies Message);
      workers.push(worker);
    }
    this.workers = workers;
  }

  stop() {
    THREADS = 1;
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
        } satisfies Message);
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

// concurrent programming primitives

const LOCKED = 1;
const UNLOCKED = 0;
const MUTEX_INDEX = 0;
const BARRIER_INDEX = 1;
let barrierCount = 0;

async function barrier() {
  // log(`syncing ${barrierCount}`);
  await lock();
  let expected = (barrierCount + 1) * THREADS;
  let arrived = Atomics.add(sharedArray, BARRIER_INDEX, 1) + 1;
  if (arrived === expected) {
    // log(`notifying sync #${barrierCount}`);
    unlock();
    Atomics.notify(sharedArray, BARRIER_INDEX);
  } else {
    // log(`waiting for sync #${barrierCount} (${arrived} threads got here)`);
    // TODO this feels almost like cheating, to separate promise creation from awaiting
    // to guarantee that we wait on an `arrived` value that is consistent with the value written
    // by `add()`, since we unlock only after having issued the waitAsync call
    let { value } = Atomics.waitAsync(
      sharedArray,
      BARRIER_INDEX,
      arrived,
      5000
    );
    unlock();
    let returnValue = await value;
    assert(
      returnValue === "ok",
      `${thread}: bad sync #${barrierCount}, got ${returnValue}`
    );
  }
  barrierCount++;
}

async function lock(data: Int32Array = sharedArray, index = MUTEX_INDEX) {
  while (Atomics.compareExchange(data, index, UNLOCKED, LOCKED) !== UNLOCKED) {
    // someone else is writing, wait for them to finish
    await Atomics.waitAsync(data, 0, LOCKED).value;
  }
}

function unlock(data: Int32Array = sharedArray, index = MUTEX_INDEX) {
  let state = Atomics.compareExchange(data, index, LOCKED, UNLOCKED);
  assert(state === LOCKED, "bad mutex");
  Atomics.notify(data, MUTEX_INDEX);
}

function range(n: number) {
  let nt = Math.ceil(n / THREADS);
  let start = Math.min(n, thread * nt);
  let end = Math.min(n, thread === THREADS - 1 ? n : start + nt);
  return [start, end];
}

function rangeMain(n: number) {
  if (isMain()) return [0, n];
  return [0, 0];
}
