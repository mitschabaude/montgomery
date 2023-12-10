import { expose, t, T } from "./threads.js";

export { api };

const api = {
  add: (a: number, b: number) => {
    console.log({ t, T });
    return a + b;
  },
};

expose(api);
