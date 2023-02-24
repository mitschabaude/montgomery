# Future wasm-generate

In this folder I'm currently working on creating a full-on Wasm DSL for TS. It is intended to replace `./lib/wasm-generate.js` which is stringly-typed, error-prone, annoying to use, awful to debug and impossible to read.

Goals:

- Write low-level Wasm from TS
- API directly corresponds to Wasm opcodes, like `i32.add` etc
- Type-safe
- Great debugging DX. Example: error messages point to the place in your code where the offending opcode is added

- Readability. Wasm code should look imperative - like writing WAT by hand, just with better DX:

```ts
const myFunction = func({ in: { x: i32, y: i32 }, out: [i32] }, ({ x, y }) => {
  local.get(x);
  local.get(y);
  i32.add();
  i32.const(2);
  i32.shl();
  call(otherFunction);
});
```

- Probably: A few optional conveniences to reduce boilerplate assembly like `local.get` and `i32.const`:

```ts
const myFunction = func({ in: { x: i32, y: i32 }, out: [i32] }, ({ x, y }) => {
  i32.add(x, y);
  i32.shl($, 2); // $ is the top of the stack
  call(otherFunction);
});

// or maybe

const myFunction = func({ in: { x: i32, y: i32 }, out: [i32] }, ({ x, y }) => {
  let z = i32.add(x, y);
  let result = call(otherFunction, [i32.shl(z, 2)]);
});
```

- DLS should make declaration of modules trivial -- just declare the exports and all necessary dependencies are collected for you:

```ts
let module = Module({ exports: { myFunction } });
let instance = await module.instantiate();

// inference of exported function type signatures:
instance.exports.myFunc;
//                 ^ (arg_0: number, arg_1: number) => number
```
