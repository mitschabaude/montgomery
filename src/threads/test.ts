import { createMsmField } from "../field-msm.js";
import { WasmArtifacts } from "../types.js";
import { expose, t, T } from "./threads.js";

export { createTest };
expose(createTest);

async function createTest(
  x: number,
  params: Parameters<typeof createMsmField>[0],
  wasm?: WasmArtifacts
) {
  let Field = await createMsmField(params, wasm);
  console.log("instance on thread", t, Field.constants);
  return expose("Test", {
    log(s: string) {
      console.log({ t, T, s, x });
    },
    wasm: Field.wasmArtifacts,
  });
}
