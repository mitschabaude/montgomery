import { pallasParams } from "../concrete/pasta.params.ts";
import { curveParams as bls12377Params } from "../concrete/bls12-377.params.ts";

export { prebuiltCurves, type PrebuiltCurve };

/** Weierstraß curves whose Wasm modules are built ahead of time */
const prebuiltCurves = {
  pallas: pallasParams,
  bls12377: bls12377Params,
};

type PrebuiltCurve = keyof typeof prebuiltCurves;
