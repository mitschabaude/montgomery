import { createFieldFromWasm, MsmFieldWasm } from "../field-msm.js";
import { WasmArtifacts } from "../types.js";
import { expose, t, T } from "./threads.js";

export { createTest };
expose(createTest);

async function createTest(
  x: number,
  params: Parameters<typeof createFieldFromWasm>[0],
  wasm: WasmArtifacts,
  instance?: MsmFieldWasm
) {
  let Field = await createFieldFromWasm(params, wasm, instance);
  console.log("instance on thread", t, Field.constants);
  return expose("Test", {
    log(s: string) {
      console.log({ t, T, s, x });
    },
  });
}
