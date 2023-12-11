import { createFieldFromWasm } from "../field-msm.js";
import { expose, t, T } from "./threads.js";

export { add, createMul };

const add = {
  add: async (a: number, b: number) => {
    console.log({ t, T });
    return a + b;
  },
};

async function createMul(
  x: number,
  params: Parameters<typeof createFieldFromWasm>[0],
  wasm: { module: WebAssembly.Module; memory: WebAssembly.Memory }
) {
  let Field = await createFieldFromWasm(params, wasm);
  console.log("instance on thread", t, Field.constants);
  let api = {
    mul: async (a: number) => {
      console.log({ t, T });
      return a * x;
    },
  };
  expose(api);
  return api;
}

expose(add);
expose({ createMul });
