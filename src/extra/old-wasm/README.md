# Deprecated MSM implementation

This contains the old MSM implementation in pure JS (with JSdoc), and wasm files generated using lib/wasm-generate.

We no longer want to use this, but it's kept functional as it still contains some code and experiments not part of the new implementation.

To build the wasm files here, use:

```sh
node src/extra/old-wasm/finite-field-compile.js
```

After that, you should be able to run:

```sh
node src/extra/old-wasm/scripts/run.js 12
```
