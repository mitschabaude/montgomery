/**
 * The BLS12-377 curve with prebuilt Wasm modules, which loads without
 * generating code, and without wasmati.
 */
import { curveParams as bls12377Params } from "../concrete/bls12-377.params.ts";
import type { CurveOptions, Weierstraß } from "../parallel.ts";
import { loadWeierstraß } from "./load.ts";
import * as modules from "./wasm/bls12-377.ts";

export { startThreads, stopThreads } from "../parallel.ts";
export { BLS12377, type CurveOptions, type Weierstraß };

/** Factory for the BLS12-377 curve (Aleo). */
function BLS12377(options?: CurveOptions): Promise<Weierstraß> {
  return loadWeierstraß(bls12377Params, modules, options);
}
