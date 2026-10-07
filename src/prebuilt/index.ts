/**
 * Curves with prebuilt Wasm modules, which load without generating code, and
 * without wasmati. They work like the curves of the main entry point.
 */
import {
  createWeierstraß,
  startThreads,
  stopThreads,
  type CurveOptions,
  type Weierstraß,
} from "../parallel.ts";
import { resolveFieldBackend } from "../field-layout.ts";
import {
  fieldMemory,
  memoryImports,
  scalarMemory,
  type SharedMemory,
} from "../memories.ts";
import type { WasmArtifacts } from "../types.ts";
import { prebuiltCurves, type PrebuiltCurve } from "./curves.ts";
import { loadBytes } from "./load.node.ts";

export {
  Pallas,
  BLS12377,
  startThreads,
  stopThreads,
  type CurveOptions,
  type Weierstraß,
};

/** Factory for the Pallas curve (Halo 2 / Mina). */
function Pallas(options?: CurveOptions): Promise<Weierstraß> {
  return loadWeierstraß("pallas", options);
}
/** Factory for the BLS12-377 curve (Aleo). */
function BLS12377(options?: CurveOptions): Promise<Weierstraß> {
  return loadWeierstraß("bls12377", options);
}

async function loadWeierstraß(
  curve: PrebuiltCurve,
  { backend = "auto" }: CurveOptions = {}
) {
  let name = resolveFieldBackend(backend);
  let [field, scalar] = await Promise.all([
    load(`${curve}.field-${name}.wasm`, fieldMemory),
    load(`${curve}.scalar.wasm`, scalarMemory),
  ]);
  return createWeierstraß(prebuiltCurves[curve], {
    backend: name,
    field,
    scalar,
  });
}

async function load(
  file: string,
  memory: SharedMemory
): Promise<WasmArtifacts> {
  let module = await WebAssembly.compile(await loadBytes(file));
  return { module, importMap: memoryImports(memory) };
}
