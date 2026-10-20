# Cross-engine benchmarks

Tools for running our benchmarks outside Node: in the SpiderMonkey shell (Firefox's JS engine) and in headless Firefox and Chromium. Firefox builds are downloaded into `~/.cache/montgomery/` (linux x64).

## SpiderMonkey shell

```sh
node scripts/bench/shell.ts scripts/field-benchmarks/wide.ts pallas
node scripts/bench/shell.ts --firefox nightly scripts/field-benchmarks/wide.ts bn254-scalar
```

Bundles the entry for the shell with `shims.ts` for missing globals and stubs for Node builtins.

## Browsers

```sh
node scripts/bench/browser.ts firefox scripts/run-msm-pallas.ts 16 8 --evaluate
node scripts/bench/browser.ts chromium --wide scripts/run-msm-bn254.ts 20 8 --evaluate --backend=29-bit
```

Firefox is the stock release, driven by Playwright over WebDriver BiDi. Chromium is Playwright's; `--wide` passes `--js-flags=--wasm-wide-arithmetic`.

## Codegen kernels

`wide-kernels.ts` writes a small module with `i64.mul_wide_u`, `i64.add128` and the Pallas Montgomery multiply to `build/wide-kernels/kernels.wasm`. `wide-kernels-harness.js` runs it unchanged in Node and the SpiderMonkey shell, so both engines compile identical bytes:

```sh
node scripts/bench/wide-kernels.ts
node --wasm-wide-arithmetic --print-wasm-code --no-liftoff --no-wasm-lazy-compilation scripts/bench/wide-kernels-harness.js
js --wasm-compiler=optimizing -m scripts/bench/wide-kernels-harness.js
```

Release shells only time the kernels. A debug shell also prints Ion's machine code; Mozilla CI publishes one at `https://firefox-ci-tc.services.mozilla.com/api/index/v1/task/gecko.v2.mozilla-central.latest.firefox.linux64-debug/artifacts/public/build/target.jsshell.zip`.
