import { expose, t, T } from "./threads.js";

export { add, mul };

const add = {
  add: async (a: number, b: number) => {
    console.log({ t, T });
    return a + b;
  },
};

const mul = {
  mul: async (a: number, b: number) => {
    console.log({ t, T });
    return a * b;
  },
};

expose(add);
expose(mul);
