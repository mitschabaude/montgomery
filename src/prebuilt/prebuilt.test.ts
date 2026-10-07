/**
 * Test the curves with prebuilt Wasm modules (run `node scripts/build/prebuild.ts`
 * first): their MSMs against bigint, and that neither their entry points nor the
 * workers load wasmati, or the modules of other curves.
 */
import * as esbuild from "esbuild";
import { Pallas, startThreads, stopThreads } from "./pallas.ts";
import { BLS12377 } from "./bls12-377.ts";
import { supportsWideArithmetic } from "../field-layout.ts";
import { assert } from "../util.ts";

// the prebuilt entry points and the worker source, parallel.ts, don't import
// wasmati, the code generator, or the modules of other curves
for (let [entry, curve] of [
  ["src/prebuilt/pallas.ts", "pallas"],
  ["src/prebuilt/bls12-377.ts", "bls12-377"],
  ["src/parallel.ts", undefined],
] as const) {
  let { metafile } = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  let inputs = Object.keys(metafile!.inputs);
  let generators = inputs.filter(
    (file) =>
      file.includes("wasmati") ||
      file.endsWith("src/generate.ts") ||
      (file.includes("src/prebuilt/wasm/") &&
        !file.endsWith(`src/prebuilt/wasm/${curve}.ts`))
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
