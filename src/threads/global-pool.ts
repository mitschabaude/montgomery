import { ThreadPool, barrier, expose, isMain } from "./threads.js";

export { pool, setWorkerSource, broadcastFromMain };

let pool = ThreadPool.createInactive(import.meta.url);

function setWorkerSource(source: string) {
  pool.setSource(source);
}

// message passing

async function broadcastFromMain<T>(
  namespace: string,
  func: () => T
): Promise<T> {
  let name = `broadcast:${namespace}`;
  let promise = new Promise<T>((resolve) => {
    expose(name, function f(m: T) {
      resolve(m);
    });
  });
  // barrier so all workers are ready to receive
  await barrier();
  if (isMain()) {
    let message = func();
    await pool.callWorkers(`${name};f`, message);
    return message;
  } else {
    return promise;
  }
}
