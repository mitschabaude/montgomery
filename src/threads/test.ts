import { createMsmField } from "../field-msm.js";
import { UnwrapPromise, WasmArtifacts } from "../types.js";
import { t, T, ThreadPool } from "./threads.js";

export { createTest, startThreads, stopThreads };

async function createTest(
  x: number,
  params: Parameters<typeof createMsmField>[0],
  wasm?: WasmArtifacts
) {
  let Field = await createMsmField(params, wasm);
  console.log(
    "instance on thread",
    t,
    Field.global.offset,
    Field.local.sizeUsed()
  );

  return {
    log: pool.register("Test", function log(s: string) {
      console.log({ t, T, s, x });
    }),
    wasm: Field.wasmArtifacts,
    params,
  };
}

let pool = ThreadPool.createInactive(import.meta.url);
let createTestP = pool.register("Test", createTest);

async function startThreads(
  n: number,
  workerNumber: number,
  Test: UnwrapPromise<ReturnType<typeof createTest>>
) {
  console.log(`starting ${n} workers`);
  pool.start(n);
  await pool.callWorkers(createTest, workerNumber, Test.params, Test.wasm);
  // await createTestP(10, Test.params, Test.wasm);
}

async function stopThreads() {
  await pool.stop();
}
