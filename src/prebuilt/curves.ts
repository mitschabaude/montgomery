import { pallasParams } from "../concrete/pasta.params.ts";
import { curveParams as bls12377Params } from "../concrete/bls12-377.params.ts";

export { prebuiltCurves };

/**
 * Weierstraß curves whose Wasm modules are built ahead of time, into
 * src/prebuilt/wasm/<name>.ts, which src/prebuilt/<name>.ts loads
 */
const prebuiltCurves = {
  pallas: pallasParams,
  "bls12-377": bls12377Params,
};
