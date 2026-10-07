/**
 * Limb layouts of the field backends, and the choice of backend. This doesn't
 * depend on wasmati, so that it can be used with prebuilt modules.
 */
import { montgomeryParams } from "./bigint/field-util.ts";
import { wideParams } from "./wide/params.ts";

export {
  fieldLayout,
  resolveFieldBackend,
  supportsWideArithmetic,
  type FieldBackendName,
  type FieldBackendOption,
  type FieldLayout,
};

/**
 * - `"29-bit"`: w-bit limbs (w = 29 by default) in 32-bit words, with spare
 *   bits that let curve formulas skip reductions.
 * - `"wide"`: full 64-bit limbs using Wasm wide arithmetic
 *   (`--wasm-wide-arithmetic`), about 2x faster arithmetic.
 */
type FieldBackendName = "29-bit" | "wide";
/** `"auto"` picks `"wide"` if the runtime supports Wasm wide arithmetic. */
type FieldBackendOption = FieldBackendName | "auto";

type FieldLayout = {
  name: FieldBackendName;
  p: bigint;
  /** bits per limb */
  w: number;
  /** number of limbs */
  n: number;
  /** bytes per field element */
  size: number;
  /** Montgomery radix */
  R: bigint;
  /** field elements passed between operations are in [0, limit) */
  limit: bigint;
};

function fieldLayout(
  name: FieldBackendName,
  p: bigint,
  { w = 29, minExtraBits }: { w?: number; minExtraBits?: number } = {}
): FieldLayout {
  if (name === "29-bit") {
    let { n, R } = montgomeryParams(p, w, minExtraBits);
    return { name, p, w, n, size: 4 * n, R, limit: 2n * p };
  }
  let { n, size, R, limit } = wideParams(p);
  return { name, p, w: 64, n, size, R, limit };
}

function resolveFieldBackend(option: FieldBackendOption): FieldBackendName {
  if (option !== "auto") return option;
  return supportsWideArithmetic() ? "wide" : "29-bit";
}

// a module with one function that uses i64.mul_wide_u
const wideArithmeticProbe = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 8, 1, 96, 2, 126, 126, 2, 126, 126, 3, 2, 1,
  0, 7, 9, 1, 5, 112, 114, 111, 98, 101, 0, 0, 12, 1, 0, 10, 10, 1, 8, 0, 32, 0,
  32, 1, 252, 22, 11,
]);

let wideSupport: boolean | undefined;

function supportsWideArithmetic() {
  wideSupport ??= WebAssembly.validate(wideArithmeticProbe);
  return wideSupport;
}
