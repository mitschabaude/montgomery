import { Dependency, JSFunction } from "wasmati";

export { AnyFunction, UnwrapPromise, WasmArtifacts, WasmFunctions };

type AnyFunction = (...args: any) => any;

type UnwrapPromise<T> = T extends Promise<infer U> ? U : never;

type WasmArtifacts = {
  module: WebAssembly.Module;
  memory: WebAssembly.Memory;
};

type WasmFunctions<
  Exports extends Record<string, any>,
  Keys extends keyof Exports = keyof Exports
> = Pick<
  {
    [K in keyof Exports]-?: Exports[K] extends Dependency.AnyFunc
      ? JSFunction<Exports[K]>
      : never;
  },
  {
    [K in Keys]-?: Exports[K] extends Dependency.AnyFunc ? K : never;
  }[Keys]
>;
