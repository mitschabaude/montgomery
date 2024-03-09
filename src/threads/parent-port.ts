import { parentPort } from "node:worker_threads";
export { messagePort as parentPort };

// implement browser-compatible parentPort from node:worker_threads
let messagePort: Pick<Window, "addEventListener" | "postMessage"> | null =
  parentPort && {
    addEventListener<K extends keyof WindowEventMap>(
      type: K,
      listener: (ev: WindowEventMap[K]) => any,
      options?: boolean | AddEventListenerOptions
    ) {
      parentPort?.on(type, (message: any) => {
        listener({ data: message } as any);
      });
    },
    postMessage(message: any) {
      parentPort?.postMessage(message);
    },
  };
