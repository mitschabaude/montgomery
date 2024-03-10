/**
 * Simple Worker interface to normalize browser and Node.js APIs.
 */
import type { Worker as NodeWorker, MessagePort } from "node:worker_threads";
import { assert } from "../util.js";

export {
  SimpleWorker,
  WorkerConstructor,
  fromWebWorker,
  fromWebTarget,
  fromNodeWorker,
  fromNodeTarget,
  awaitMessage,
};

type MessageListener<M> = (message: M) => void;

type MessageTarget<M> = {
  postMessage(message: M): void;
  onMessage(listener: MessageListener<M>): void;
  offMessage(listener: MessageListener<M>): void;
};

type SimpleWorker<M> = MessageTarget<M> & {
  _worker: Worker | NodeWorker;
  /**
   * Allow the main thread to exit even if this worker is still running.
   */
  unref(): void;
  /**
   * Kill the worker.
   */
  terminate(): Promise<void>;
};

type WorkerConstructor = <M>(url: URL, name?: string) => SimpleWorker<M>;

/**
 * Wrap a web worker.
 */
function fromWebWorker<M>(webWorker: Worker): SimpleWorker<M> {
  return {
    _worker: webWorker,
    unref() {
      // no-op, there is no process exit in the browser
    },
    async terminate() {
      webWorker.terminate();
    },
    ...fromWebTarget(webWorker),
  };
}

/**
 * Wrap a browser "message" event target.
 */
function fromWebTarget<M>(target: Window | Worker): MessageTarget<M> {
  let listeners = new WeakMap<MessageListener<M>, EventListener>();

  return {
    postMessage(message) {
      target.postMessage(message);
    },
    onMessage(listener) {
      const wrapped: EventListener = (event: Event) => {
        if (!("data" in event) || event.type !== "message") return; // ignore non-message events
        listener(event.data as M);
      };
      listeners.set(listener, wrapped);
      target.addEventListener("message", wrapped);
    },
    offMessage(listener) {
      let wrapped = listeners.get(listener);
      if (wrapped !== undefined) {
        listeners.delete(listener);
        target.removeEventListener("message", wrapped);
      }
    },
  };
}

/**
 * Wrap a Node.js message target
 */
function fromNodeTarget<M>(target: NodeWorker | MessagePort): MessageTarget<M> {
  return {
    postMessage(message) {
      target.postMessage(message);
    },
    onMessage(listener) {
      target.on("message", listener);
    },
    offMessage(listener) {
      target.off("message", listener);
    },
  };
}

/**
 * Wrap a Node.js worker
 */
function fromNodeWorker<M>(nodeWorker: NodeWorker): SimpleWorker<M> {
  return {
    _worker: nodeWorker,
    unref() {
      nodeWorker.unref();
    },
    async terminate() {
      await nodeWorker.terminate();
    },
    ...fromNodeTarget(nodeWorker),
  };
}

/**
 * Helper to await the next message from a worker.
 */
function awaitMessage<M>(
  target: MessageTarget<M>,
  filter?: (message: M) => boolean
): Promise<M> {
  return new Promise((resolve) => {
    target.onMessage(function listener(message: M) {
      if (filter === undefined || filter(message)) {
        target.offMessage(listener);
        resolve(message);
      }
    });
  });
}
