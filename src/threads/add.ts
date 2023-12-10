import { expose, t, T } from "./threads.js";

export { add, createMul };

const add = {
  add: async (a: number, b: number) => {
    console.log({ t, T });
    return a + b;
  },
};

function createMul(x: number, wasm: WebAssembly.Module) {
  console.log({ wasm });
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
