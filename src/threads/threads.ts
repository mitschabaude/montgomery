import { Worker, getParentPort, availableParallelism } from "./worker.node.ts";
import { assert } from "../util.ts";
import { type AnyFunction } from "../types.ts";
import { type SimpleWorker, awaitMessage } from "./simple-worker.ts";

export {
  thread as t,
  THREADS as T,
  thread,
  THREADS,
  isMain,
  isParallel,
  expose,
  ThreadPool,
  setDebug,
  log,
  logMain,
  sharedArray,
  range,
  claim,
  barrier,
  assertIsMain,
  shareOf,
};

let thread = 0;
let THREADS = 1;

const SHARED_POINTERS = 1;

let sharedArray = new Int32Array(new SharedArrayBuffer(4 * SHARED_POINTERS));

function isMain() {
  return thread === 0;
}
function isParallel() {
  return THREADS > 1;
}

function assertIsMain() {
  assert(thread === 0, "this can only run on the main thread");
}

function log(...args: any) {
  console.log(`${thread}:`, ...args);
}

function logMain(...args: any) {
  if (isMain()) console.log("main:", ...args);
}

let DEBUG = false;
function setDebug(debug: boolean) {
  DEBUG = debug;
}

type Message =
  | { type: "call"; func: string; args: any[]; callId: number }
  | { type: "answer"; callId: number }
  | {
      type: "init";
      thread: number;
      THREADS: number;
      sharedArray: SharedArrayBuffer;
    };

type PoolWorker = SimpleWorker<Message>;

const functions = new Map<string, (...args: any) => any>();
const parentPort = getParentPort<Message>();

parentPort?.onMessage(async (message: Message) => {
  if (DEBUG) console.log(`worker ${thread}/${THREADS} got message`, message);

  if (message.type === "call") {
    let { func: funcName, args, callId } = message;

    let func = functions.get(funcName);
    if (func === undefined) {
      throw Error(`Method ${message.func} not registered`);
    }

    await func(...args);
    parentPort.postMessage({ type: "answer", callId });
  } else if (message.type === "init") {
    thread = message.thread;
    THREADS = message.THREADS;
    sharedArray = new Int32Array(message.sharedArray);
    parentPort.postMessage({ type: "answer", callId: 0 });
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
  workers: PoolWorker[];
  isRunning: boolean;

  constructor(source: URL | string, workers: PoolWorker[]) {
    this.source = typeof source === "string" ? new URL(source) : source;
    this.workers = workers;
    this.isRunning = workers.length > 0;
  }

  setSource(source: URL | string) {
    assert(
      !this.isRunning,
      "ThreadPool is running. The source must be set when starting the pool, so set it before starting (or after stopping)."
    );
    this.source = typeof source === "string" ? new URL(source) : source;
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
    this.isRunning = true;
    const workers: PoolWorker[] = [];
    let promises = [];
    for (let t = 1; t < T; t++) {
      let worker = Worker<Message>(this.source, `ThreadPool worker #${t}`);
      // TODO: do we want this?
      worker.unref?.();
      worker.postMessage({
        type: "init",
        thread: t,
        THREADS: T,
        sharedArray: sharedArray.buffer,
      });

      let initPromise = awaitMessage(
        worker,
        (m) => m.type === "answer" && m.callId === 0
      );
      promises.push(initPromise);
      workers.push(worker);
    }
    this.workers = workers;
    return Promise.all(promises);
  }

  stop() {
    THREADS = 1;
    resetSharedArray();
    this.isRunning = false;
    let promises = this.workers.map((worker) => worker.terminate());
    this.workers = [];
    return Promise.all(promises);
  }

  callWorkers<T extends AnyFunction>(func: string | T, ...args: Parameters<T>) {
    let funcName =
      typeof func === "string"
        ? func
        : withNamespace((func as any)[NAMESPACE], func.name);
    let promises = this.workers.map((worker) => {
      let callId = Math.random();
      worker.postMessage({
        type: "call",
        func: funcName,
        args,
        callId,
      });

      return awaitMessage(
        worker,
        (m) => m.type === "answer" && m.callId === callId
      );
    });
    return Promise.all(promises);
  }

  parallelize<T extends Record<string, any> | AnyFunction>(
    api: T,
    { waitForWorkers = true } = {}
  ): Parallelized<T> {
    if (typeof api === "function") {
      let func = api as AnyFunction & T;
      let calledName = withNamespace((func as any)[NAMESPACE], func.name);
      return (async (...args: any) => {
        let workersDone = this.callWorkers(calledName, ...args);
        let mainResult = func(...args);
        let result;
        if (waitForWorkers) {
          [result] = await Promise.all([mainResult, workersDone]);
        } else {
          result = await mainResult;
        }
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
        let result;
        if (waitForWorkers) {
          [result] = await Promise.all([mainResult, workersDone]);
        } else {
          result = await mainResult;
        }
        return result;
      };
    }
    return parallelApi;
  }

  register<T extends Record<string, AnyFunction> | AnyFunction>(
    api: T,
    options?: { waitForWorkers?: boolean }
  ): Parallelized<T>;
  register<T extends Record<string, any> | AnyFunction>(
    namespace: string,
    api: T,
    options?: { waitForWorkers?: boolean }
  ): Parallelized<T>;
  register(apiOrNamespace: any, maybeApi?: any, maybeOptions?: any) {
    let api = expose(apiOrNamespace, maybeApi);
    let options = typeof apiOrNamespace === "string" ? maybeOptions : maybeApi;
    if (isMain()) return this.parallelize(api, options);
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

const BARRIER_INDEX = 0;
// iterations to spin before blocking, since threads usually arrive close together
const BARRIER_SPIN = 10_000;
let barrierCount = 0;

/**
 * Waits until all threads have arrived. Workers block synchronously after
 * spinning: waking up from `Atomics.waitAsync` can take milliseconds. The main
 * thread may not block in browsers, so it waits asynchronously.
 */
async function barrier() {
  if (!isParallel()) return;
  barrierCount++;
  let expected = barrierCount * THREADS;
  let arrived = Atomics.add(sharedArray, BARRIER_INDEX, 1) + 1;
  if (arrived === expected) {
    Atomics.notify(sharedArray, BARRIER_INDEX);
    return;
  }
  for (let i = 0; i < BARRIER_SPIN; i++) {
    if (Atomics.load(sharedArray, BARRIER_INDEX) >= expected) return;
  }
  while (true) {
    let current = Atomics.load(sharedArray, BARRIER_INDEX);
    if (current >= expected) return;
    let result = isMain()
      ? await Atomics.waitAsync(sharedArray, BARRIER_INDEX, current, 5000).value
      : Atomics.wait(sharedArray, BARRIER_INDEX, current, 5000);
    assert(
      result !== "timed-out",
      `${thread}: barrier #${barrierCount} timed out`
    );
  }
}

function resetSharedArray() {
  barrierCount = 0;
  sharedArray.fill(0);
}

function range(n: number, nThreads = THREADS) {
  let nt = Math.ceil(n / nThreads);
  let start = Math.min(n, thread * nt);
  let end = Math.min(n, thread === nThreads - 1 ? n : start + nt);
  return [start, end];
}

/**
 * Distributes `n` work items across threads dynamically: each step claims the
 * next `chunkSize` items `[start, end)` from a shared counter, so faster threads
 * take more work. All threads must claim from the same counter, initially 0.
 */
function* claim(
  counters: Int32Array,
  index: number,
  n: number,
  chunkSize = 1
): Generator<[number, number]> {
  while (true) {
    let start = Atomics.add(counters, index, chunkSize);
    if (start >= n) return;
    yield [start, Math.min(start + chunkSize, n)];
  }
}

function shareOf(n: number) {
  let nt = Math.ceil(n / THREADS);
  let start = Math.min(n, thread * nt);
  let end = Math.min(n, thread === THREADS - 1 ? n : start + nt);
  return end - start;
}
