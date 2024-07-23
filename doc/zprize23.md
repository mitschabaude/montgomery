# montgomery: Fast MSM in WebAssembly

_submitted to Zprize '23, by Gregor Mitscha-Baude_

This repo contains 2 submissions:

- `submission.ts` for the main prize as originally intended: MSM over [Aleo's twisted edwards curve](https://docs.rs/ark-ed-on-bls12-377/latest/ark_ed_on_bls12_377) over the scalar field of BLS12-377.
- `submission-bls377.ts` for the side prize that was introduced midway through the competition: MSM over [BLS12-377](https://neuromancer.sk/std/bls/BLS12-377), a short Weierstrass curve.

To get started, see the below section on [using the submission](#using-the-submission).

## Summary and results

- We use multi-threaded Wasm and JS. No WebGPU.
- The submission further builds on the library I used for Zprize '22. It significantly extends that library:
  - Last year's MSM, based on batch-affine additions, was extended to support a wide range of curves from the same code base, e.g. BLS12-377, BLS12-381 and Pallas.
  - Added a second MSM which should essentially support all elliptic curves whatsoever (the required interface is just add, double, negate, zero). We use this for the twisted edwards curve.
- Seamless multi-threading support for both Node.js and the web. A thread pool can be started and stopped with any number of workers (i.e. `startThreads(8)`), but parallel implementations like our MSMs work in any case, and gracefully fall back to single-threaded execution if no threads have been started.
  - Notably, all complexity, like creation of wasm modules, providing workers with the right wasm code to run, and even the inclusion of the worker's source code, is fully handled internally. So this is usable as a plain JS library with a single import and no extra files for workers and wasm that have to be included, as is common in other libraries.
- WebAssembly code is defined entirely from TS and the binary is generated at runtime, using my own [wasmati](https://github.com/zksecurity/wasmati) library - which emerged from Zprize '22.
- The submission is intended to form the basis for `montgomery`, a super-fast and extensible library for client-side cryptography, which I will publish to npm and maintain going forward.

**Performance**. Thanks to multi-threading and some other improvements we consistently observe > 5x speedup over last year's Zprize results (on the same curve). The new (~256-bit) twisted edwards implementation exhibits performance very similar to ~256-bit Weierstrass curves with batched-affine additions, like Pallas. It is significantler faster than the larger BLS12-377 and last year's BLS12-381.

Example: On my laptop, a 2^16-sized twisted edwards MSM takes 80ms.

**Memory**. The twisted edwards MSM has much lighter memory usage and currently works for input sizes up to 2^21. Similarly, memory usage for Weierstrass curves was improved, so that BLS12-377 works for inputs up to size 2^20. We expect that both of these can be increased by another 2-4 factor in the future.

## Using the submission

To run the following commands, first switch into the `src/submission` directory (same directory as this README). Install npm dependencies.

```sh
cd src/submission
npm i
```

A single command builds both submissions, such that they can be included into the main test harness:

```sh
npm run build-submission
```

On success, this should print:

```
built for the browser: build/web/submission.js
built for the browser: build/web/submission-bls377.js
```

These two JS files contain everything needed by the submissions (including wasm and web worker code) in a single file, bundled for the web.

In the test harness, we import these build output files instead of the TS source code:

```ts
import { compute_msm } from "../submission/build/web/submission.js";
```

We also build matching TS type definitions so `compute_msm` has proper intellisense.

### Why is there a separate build step?

Having a separate build step for the submission code enables us to keep some custom TS and build setup which webpack doesn't need to handle:

- Experimental `using` declarations and possibly other behaviour that is supported by TS only in recent releases
- Custom web worker build which inlines the worker source into the JS bundle, so that the submission behaves 'like a library' which can just resolve to a single file on import. (This will make it easier to use the submission as an npm package later on.)

### Known limitations

- Currently, there are a lot of webpack complaints about TS compile errors. They seem entirely unnecessary because the submission `d.ts` doesn't have any of these in its dependency tree. So, the solution should probably just be to make webpack somehow ignore all those TS files. I didn't have time yet to do that and didn't see it as a blocker because webpack's JS output works as expected.

- The submission currently does not work in Firefox (due to use of `Atomics.waitAsync`) and was not tested / is not expected to work in Safari or any other browser besides Chrome. I want to fix this in the near future to make the library more usable, but the prize was specifically only targeting Chrome 115.

- Due to time constraints, the submission only supports points in bigint format. This is actually a shame because the conversion from bigint takes a significant portion of time. Better results can be observed in all of our [internal tests](#internal-tests-and-scripts) which usually generate random points directly in the same wasm memory as the submission code, and so don't exhibit any transformation overhead.

## Direct testing of both submissions

In addition to integration with the test harness, there are various tests to run directly from the submission folder.

Two simple tests test the submission's `compute_msm()` interface directly:

- `submission-test.ts` for the twisted edwards curve
- `submission-test-bls377.ts` for the BLS curve

After having done `npm run build`, the `./run` script can be pointed at either of these to run it in Node.js:

```sh
> ./run submission-test-bls377.ts
ok
```

They can also be run in Chrome by calling the `./run-in-browser` script:

```sh
> ./run-in-browser submission-test-bls377.ts
running in the browser: build/web/submission-test-bls377.js
Server is running on: http://localhost:8000
```

This just serves a web build of the script locally, so upon navigating to http://localhost:8000 you can see the script successfully executing in the browser.

## Internal tests and scripts

There are plenty of scripts (in `/scripts`) and unit/integration tests (`.test.ts` files) to test or benchmark various aspects of this library on various curves and finite fields. All of them can be run with `./run`, and most will also work in the browser with `./run-in-browser`.

To run all `.test.ts` tests, you can also use `npm test`. (Note: at the time of writing, there are two known failing test cases unrelated to this submission.) Check out other scripts in `package.json` - they are all expected to work.

To benchmark the submitted MSMs on a given number of points and using a given number of threads, I used the following scripts. They run the target multiple times and report mean and deviation of 10 runs (after 5 warmup runs), as well as detailed time logging of steps in the MSM:

```sh
# twisted edwards MSM on 2^18 random points with 16 threads
> ./run scripts/run-msm-ed-377.ts 18 16 --evaluate

...
msm (n=18)... 322ms ± 8ms
```

```sh
# bls12-377 MSM on 2^16 random points with 16 threads
> ./run scripts/run-msm-377.ts 16 8 --evaluate

...
msm (n=16)... 122ms ± 3ms
```
