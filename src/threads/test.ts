import { createFieldFromWasm, MsmFieldWasm } from "../field-msm.js";
import { expose, t, T } from "./threads.js";

export { createTest };
expose(createTest);

async function createTest(
  x: number,
  params: Parameters<typeof createFieldFromWasm>[0],
  wasm: { module: WebAssembly.Module; memory: WebAssembly.Memory },
  instance?: MsmFieldWasm
) {
  let Field = await createFieldFromWasm(params, wasm, instance);
  console.log("instance on thread", t, Field.constants);
  let api = {
    log: (s: string) => {
      console.log({ t, T, s, x });
    },
  };
  expose(api, "Test");
  return api;
}
