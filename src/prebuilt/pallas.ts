/**
 * The Pallas curve with prebuilt Wasm modules, which loads without generating
 * code, and without wasmati.
 */
import { pallasParams } from "../concrete/pasta.params.ts";
import type { CurveOptions, Weierstraß } from "../parallel.ts";
import { loadWeierstraß } from "./load.ts";
import * as modules from "./wasm/pallas.ts";

export { startThreads, stopThreads } from "../parallel.ts";
export { Pallas, type CurveOptions, type Weierstraß };

/** Factory for the Pallas curve (Halo 2 / Mina). */
function Pallas(options?: CurveOptions): Promise<Weierstraß> {
  return loadWeierstraß(pallasParams, modules, options);
}
