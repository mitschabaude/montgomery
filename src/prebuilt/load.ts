import {
  createWeierstraß,
  type CurveOptions,
  type Weierstraß,
} from "../parallel.ts";
import type { CurveParams } from "../bigint/affine-weierstrass.ts";
import { resolveFieldBackend, type FieldBackendName } from "../field-layout.ts";
import {
  fieldMemory,
  memoryImports,
  scalarMemory,
  type SharedMemory,
} from "../memories.ts";
import type { WasmArtifacts } from "../types.ts";
import { toBytes } from "./base64.ts";

export { loadWeierstraß, type PrebuiltModules };

/** a curve's prebuilt modules in base64, written by scripts/build/prebuild.ts */
type PrebuiltModules = {
  field: Record<FieldBackendName, string>;
  scalar: string;
};

/** a Weierstraß curve from its prebuilt modules */
async function loadWeierstraß(
  params: CurveParams,
  modules: PrebuiltModules,
  { backend = "auto" }: CurveOptions = {}
): Promise<Weierstraß> {
  let name = resolveFieldBackend(backend);
  let [field, scalar] = await Promise.all([
    load(modules.field[name], fieldMemory),
    load(modules.scalar, scalarMemory),
  ]);
  return createWeierstraß(params, { backend: name, field, scalar });
}

async function load(
  base64: string,
  memory: SharedMemory
): Promise<WasmArtifacts> {
  let module = await WebAssembly.compile(toBytes(base64));
  return { module, importMap: memoryImports(memory) };
}
