// Ambient typings so `Symbol.dispose` / `Symbol.asyncDispose` resolve in
// consumers' type-checking even when their tsconfig target/lib doesn't
// include esnext.disposable or es2024+. Matches the runtime polyfill below.
declare global {
  interface SymbolConstructor {
    readonly dispose: unique symbol;
    readonly asyncDispose: unique symbol;
  }
}

if (typeof Symbol.dispose !== "symbol")
  Object.defineProperty(Symbol, "dispose", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Symbol.for("dispose"),
  });

if (typeof Symbol.asyncDispose !== "symbol")
  Object.defineProperty(Symbol, "asyncDispose", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Symbol.for("asyncDispose"),
  });

export {};
