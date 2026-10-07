/**
 * Test the curves with prebuilt Wasm modules (run `node scripts/build/prebuild.ts`
 * first): their MSMs against bigint, and that neither the prebuilt entry point
 * nor the workers load wasmati.
 */
import * as esbuild from "esbuild";
import { BLS12377, Pallas, startThreads, stopThreads } from "./index.ts";
import { supportsWideArithmetic } from "../field-layout.ts";
import { assert } from "../util.ts";

// the prebuilt entry point and the worker source, parallel.ts, don't import
// wasmati or the code generator
for (let entry of ["src/prebuilt/index.ts", "src/parallel.ts"]) {
  let { metafile } = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  let inputs = Object.keys(metafile.inputs);
  let generators = inputs.filter(
    (file) => file.includes("wasmati") || file.endsWith("src/generate.ts")
  );
  assert(generators.length === 0, `${entry} imports ${generators.join(", ")}`);
}

await startThreads(4);
let backends = supportsWideArithmetic() ? ["29-bit", "wide"] : ["29-bit"];
for (let [label, create] of [
  ["pallas", Pallas],
  ["bls12-377", BLS12377],
] as const) {
  for (let backend of backends as ("29-bit" | "wide")[]) {
    let Curve = await create({ backend });
    let { Field, Affine, Projective, Scalar, Parallel, Bigint } = Curve;
    let N = 1 << 10;
    using _ = Field.local.atCurrentOffset;
    let pointPtrs = await Parallel.randomPointsFast(N);
    let scalarPtrs = await Parallel.randomScalars(N);
    let points = pointPtrs.map((g) =>
      Bigint.Projective.fromAffine(Affine.toBigint(g))
    );
    let scalars = scalarPtrs.map((s) => Scalar.readBigint(s));
    let { result } = await Parallel.msm(scalarPtrs[0], pointPtrs[0], N);
    let s = Projective.toBigint(result);
    assert(
      Bigint.Projective.isEqual(s, Bigint.Projective.msm(scalars, points)),
      `prebuilt ${label} (${backend}): msm failed`
    );
    console.log(`prebuilt ${label} (${backend}): msm matches bigint`);
  }
}
await stopThreads();
