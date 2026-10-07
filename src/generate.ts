/**
 * Generates the Wasm modules of fields and scalars with wasmati, and the curve
 * factories that compile them at runtime. Everything that runs a curve, also in
 * workers, only needs the compiled modules, see {@link createWeierstraß}.
 */
import {
  Module,
  constant,
  global,
  i32,
  importMemory,
  type AnyMemory,
} from "wasmati";
import { ImplicitMemory } from "./wasm/wasm-util.ts";
import { curveOps } from "./wasm/curve.ts";
import { createFieldBackend } from "./field-backend.ts";
import { glvGeneral } from "./wasm/glv.ts";
import {
  decomposeAndSlice,
  extractBitSlice,
  fromPackedBytes,
} from "./wasm/field-helpers.ts";
import { montgomeryParams } from "./bigint/field-util.ts";
import { resolveFieldBackend } from "./field-layout.ts";
import { fieldMemory, scalarMemory, type SharedMemory } from "./memories.ts";
import { type MsmFieldParams } from "./field-msm.ts";
import { type GlvScalarParams } from "./scalar-glv.ts";
import { type ScalarParams } from "./scalar-simple.ts";
import { type WasmArtifacts } from "./types.ts";
import {
  createWeierstraß,
  createTwistedEdwards,
  type CurveOptions,
  type TwistedEdwardsWasm,
  type WeierstraßWasm,
  type Weierstraß as WeierstraßCurve,
  type TwistedEdwards as TwistedEdwardsCurve,
} from "./parallel.ts";
import { type CurveParams } from "./bigint/affine-weierstrass.ts";
import { type CurveParams as TwistedEdwardsParams } from "./bigint/twisted-edwards.ts";
import { assert } from "./util.ts";

export {
  Weierstraß,
  TwistedEdwards,
  compileWeierstraß,
  compileTwistedEdwards,
  compileField,
  compileScalar,
  fieldModule,
  glvScalarModule,
  scalarModule,
};

/**
 * Short Weierstrass curve with batched-affine additions and GLV-endomorphism
 * accelerated scalar multiplication. Instantiate with `Weierstraß.create(params)`.
 */
type Weierstraß = WeierstraßCurve;
const Weierstraß = {
  /**
   * Create a short Weierstrass curve from its parameters, with Wasm modules
   * that are generated for them. Only curves with `a = 0` and a GLV
   * endomorphism are supported.
   */
  async create(params: CurveParams, options?: CurveOptions) {
    return createWeierstraß(params, await compileWeierstraß(params, options));
  },
};

/**
 * Twisted Edwards curve with projective additions. Instantiate with
 * `TwistedEdwards.create(params)`.
 */
type TwistedEdwards = TwistedEdwardsCurve;
const TwistedEdwards = {
  /**
   * Create a twisted Edwards curve from its parameters, with Wasm modules that
   * are generated for them.
   */
  async create(params: TwistedEdwardsParams, options?: CurveOptions) {
    return createTwistedEdwards(
      params,
      await compileTwistedEdwards(params, options)
    );
  },
};

async function compileWeierstraß(
  { modulus: p, order: q, endomorphism }: CurveParams,
  { backend = "auto" }: CurveOptions = {}
): Promise<WeierstraßWasm> {
  assert(endomorphism !== undefined, "endomorphism required");
  let { beta, lambda } = endomorphism;
  let name = resolveFieldBackend(backend);
  let glv = glvScalarModule({ q, lambda, w: 29 });
  let [field, scalar] = await Promise.all([
    compileField({ p, beta, backend: name }),
    compile(glv.wasm),
  ]);
  return { backend: name, field, scalar, glv: glv.params };
}

async function compileTwistedEdwards(
  { modulus: p, order: q }: TwistedEdwardsParams,
  { backend = "auto" }: CurveOptions = {}
): Promise<TwistedEdwardsWasm> {
  let name = resolveFieldBackend(backend);
  let [field, scalar] = await Promise.all([
    compileField({ p, beta: 1n, backend: name }),
    compileScalar({ q, w: 29 }),
  ]);
  return { backend: name, field, scalar };
}

function compileField(params: MsmFieldParams) {
  return compile(fieldModule(params));
}

function compileScalar(params: ScalarParams) {
  return compile(scalarModule(params));
}

async function compile(wasm: {
  compile(): Promise<WebAssembly.Module>;
  importMap: WebAssembly.Imports;
}): Promise<WasmArtifacts> {
  return { module: await wasm.compile(), importMap: wasm.importMap };
}

function importSharedMemory({ module, field, pages }: SharedMemory): AnyMemory {
  return importMemory({ min: pages, max: pages, shared: true, module, field });
}

function fieldModule({
  p,
  beta,
  backend = "29-bit",
  w,
  minExtraBits,
}: MsmFieldParams) {
  let wasmMemory = importSharedMemory(fieldMemory);
  let implicitMemory = new ImplicitMemory(wasmMemory);

  let Field = createFieldBackend(backend, p, implicitMemory, {
    w,
    minExtraBits,
  });
  let curve = curveOps(implicitMemory, Field, beta);

  return Module({
    exports: {
      ...implicitMemory.getExports(),
      // curve ops
      ...curve,
      // multiplication
      multiply: Field.multiply,
      square: Field.square,
      leftShift: Field.leftShift,
      exp: Field.exp,
      // inverse
      inverse: Field.inverse,
      /**
       * batch inversion, using 4 field elements of scratch space
       * @param scratch
       * @param xInvs
       * @param xs
       * @param n
       */
      batchInverse: Field.batchInverse,
      // arithmetic
      add: Field.add,
      addNoReduce: Field.addNoReduce,
      subtract: Field.subtract,
      subtractPositive: Field.subtractPositive,
      reduce: Field.reduce,
      copy: Field.copy,
      // helpers
      isEqual: Field.isEqual,
      isGreater: Field.isGreater,
      isZero: Field.isZero,
      fromPackedBytes: Field.fromPackedBytes,
      toPackedBytes: Field.toPackedBytes,
    },
  });
}

function glvScalarModule({
  q,
  lambda,
  w,
}: {
  q: bigint;
  lambda: bigint;
  w: number;
}) {
  const { n, nPackedBytes } = montgomeryParams(q, w, 1);
  const { decompose, n0, maxBits } = glvGeneral(q, lambda, w, n);
  let wasmMemory = importSharedMemory(scalarMemory);

  let wasm = Module({
    exports: {
      decompose,
      decomposeAndSlice: decomposeAndSlice(decompose, w, n, n0),
      fromPackedBytesSmall: fromPackedBytes(w, n0, Math.ceil(maxBits / 8)),
      fromPackedBytes: fromPackedBytes(w, n, nPackedBytes),
      extractBitSlice: extractBitSlice(w, n0),
      extractBitSliceNoGlv: extractBitSlice(w, n),
      memory: wasmMemory,
      dataOffset: global(constant(() => i32.const(0))),
    },
  });

  let params: GlvScalarParams = { q, lambda, w, n, n0, maxBits };
  return { wasm, params };
}

function scalarModule({ q, w }: { q: bigint; w: number }) {
  const { n, nPackedBytes } = montgomeryParams(q, w, 1);
  let wasmMemory = importSharedMemory(scalarMemory);

  return Module({
    exports: {
      fromPackedBytes: fromPackedBytes(w, n, nPackedBytes),
      extractBitSlice: extractBitSlice(w, n),
      memory: wasmMemory,
      dataOffset: global(constant(() => i32.const(0))),
    },
  });
}
