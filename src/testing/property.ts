/**
 * Copyright 2023 o1Labs
 *
 * This code is taken from o1js: https://github.com/o1-labs/o1js
 */
import { Random } from "./random.js";
export { test };
export { Random, sample } from "./random.js";

const defaultTimeBudget = 100; // ms
const defaultMinRuns = 15;
const defaultMaxRuns = 400;

const test = Object.assign(testCustom(), {
  negative: testCustom({ negative: true }),
  custom: testCustom,
  verbose: testCustom({ logSuccess: true }),
});

/**
 * Create a customized test runner.
 *
 * The runner takes any number of generators (Random<T>) and a function which gets samples as inputs, and performs the test.
 * The test is performed by throwing an error when an assertion fails:
 *
 * ```ts
 * let test = testCustom();
 *
 * test(Random.nat(5), (x) => {
 *   // x is one sample of the `Random.nat(5)` distribution
 *   // we can make assertions about it by using any assertion utility which throws errors on failing assertions:
 *   expect(x).toBeLessThan(6);
 * })
 * ```
 *
 * Parameters `minRuns`, `maxRuns` and `timeBudget` determine how often a test is run:
 * - We definitely run the test `minRuns` times
 * - Then we determine how many more test fit into the `timeBudget` (time the test should take, in milliseconds)
 * - And we run the test as often as we can within that budget, but at most `maxRuns` times.
 *
 * If one run fails, the entire test stops immediately and the failing sample is printed to the console.
 *
 * The parameter `negative` inverts this behaviour: If `negative: true`, _every_ sample is expected to fail and the test
 * stops if one sample succeeds.
 *
 * The default behaviour of printing out failing samples can be turned off by setting `logFailures: false`.
 */
function testCustom({
  minRuns = defaultMinRuns,
  maxRuns = defaultMaxRuns,
  timeBudget = defaultTimeBudget,
  negative = false,
  logFailures = true,
  logSuccess = false,
} = {}) {
  function runTest<T extends readonly Random<any>[]>(
    ...args: ArrayTestArgs<T>
  ): number;
  function runTest<T extends readonly Random<any>[]>(
    label: string,
    ...args: ArrayTestArgs<T>
  ): number;
  function runTest<T extends readonly Random<any>[]>(...args: any[]) {
    let label =
      typeof args[0] === "string" ? (args.shift() as string) : undefined;

    let run: (...args: ArrayRunArgs<Nexts<T>>) => void = args.pop();
    let gens = args as any as T;
    let nexts = gens.map((g) => g.create()) as Nexts<T>;
    let start = performance.now();

    // run at least `minRuns` times
    testN(minRuns, nexts, run, { negative, logFailures });
    let time = performance.now() - start;
    let totalRuns = minRuns;

    if (!(time > timeBudget || minRuns >= maxRuns)) {
      // (minRuns + remainingRuns) * timePerRun = timeBudget
      let remainingRuns = Math.floor(timeBudget / (time / minRuns)) - minRuns;
      // run at most `maxRuns` times
      if (remainingRuns > maxRuns - minRuns) remainingRuns = maxRuns - minRuns;
      testN(remainingRuns, nexts, run, { negative, logFailures });
      totalRuns = minRuns + remainingRuns;
    }

    if (logSuccess) {
      let ms = (performance.now() - start).toFixed(1);
      let runs = totalRuns.toString().padStart(2, " ");
      let paddedLabel = (label ?? "Unlabeled test").padEnd(20, " ");
      console.log(`${paddedLabel}    success on ${runs} runs in ${ms}ms.`);
    }
    return totalRuns;
  }

  return runTest;
}

function testN<T extends readonly (() => any)[]>(
  N: number,
  nexts: T,
  run: (...args: ArrayRunArgs<T>) => void,
  { negative = false, logFailures = true } = {}
) {
  let errorMessages: string[] = [];
  let fail = false;
  let count = 0;
  for (let i = 0; i < N; i++) {
    count = 0;
    fail = false;
    let error: Error | undefined;
    let values = nexts.map((next) => next());
    try {
      (run as any)(...values);
    } catch (e: any) {
      error = e;
      fail = true;
    }
    if (fail) {
      if (negative) continue;
      if (logFailures) {
        console.log("failing inputs:");
        values.forEach((v) => console.dir(v, { depth: Infinity }));
      }
      let message = "\n" + errorMessages.join("\n");
      if (error === undefined) throw Error(message);
      error.message = `${message}\nFailed - error during test execution:
${error.message}`;
      throw error;
    } else {
      if (!negative) continue;
      if (logFailures) {
        console.log("succeeding inputs:");
        values.forEach((v) => console.dir(v, { depth: Infinity }));
      }
      throw Error("Negative test failed - one run succeeded");
    }
  }
}

// types

type Nexts<T extends readonly Random<any>[]> = {
  [i in keyof T]: T[i]["create"] extends () => () => infer U ? () => U : never;
};

type ArrayTestArgs<T extends readonly Random<any>[]> = [
  ...gens: T,
  run: (...args: ArrayRunArgs<Nexts<T>>) => void,
];

type ArrayRunArgs<Nexts extends readonly (() => any)[]> = {
  [i in keyof Nexts]: Nexts[i] extends () => infer U ? U : never;
};
