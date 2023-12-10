import { expose, t, T } from "./threads.js";

export { api };

const api = {
  add: async (a: number, b: number) => {
    console.log({ t, T });
    return a + b;
  },
};

expose(api);
