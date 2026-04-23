// Public API.
//
// Curve exports are lazy factories: calling e.g. `await Pallas()` creates
// the curve (generates wasm, sets up fields/scalars/MSM). Importing this
// module alone doesn't trigger any wasm creation — a consumer who only
// uses Pallas doesn't pay the init cost of the other curves.
//
// `startThreads` / `stopThreads` can be called before or after curve
// creation. If the pool is already running, creating a curve broadcasts
// it to workers; if the pool is started after, it picks up curves that
// were created earlier and resegments their memory for the new thread
// count.

import {
  Weierstraß,
  TwistedEdwards,
  startThreads,
  stopThreads,
} from "./parallel.ts";
import { pallasParams } from "./concrete/pasta.params.ts";
import { curveParams as bls12377Params } from "./concrete/bls12-377.params.ts";
import { curveParams as bls12381Params } from "./concrete/bls12-381.params.ts";
import { curveParams as ed377Params } from "./concrete/ed-on-bls12-377.params.ts";
import type {
  CurveParams as _CurveParams,
  BigintPoint as AffinePoint,
} from "./bigint/affine-weierstrass.ts";
import type {
  CurveParams as _TwistedEdwardsParams,
  BigintPoint as TwistedEdwardsPoint,
} from "./bigint/twisted-edwards.ts";
import type { BigintPoint as ProjectivePoint } from "./bigint/projective-weierstrass.ts";

export {
  Weierstraß,
  TwistedEdwards,
  Pallas,
  BLS12377,
  BLS12381,
  Ed377,
  startThreads,
  stopThreads,
  CurveParams,
  TwistedEdwardsParams,
  type AffinePoint,
  type ProjectivePoint,
  type TwistedEdwardsPoint,
};

/**
 * Type for curve parameters, expected by the `Weierstraß` curve factory.
 */
type CurveParams = _CurveParams;

/**
 * Pre-defined Weierstraß curve parameters.
 */
const CurveParams = {
  pallas: pallasParams,
  bls12377: bls12377Params,
  bls12381: bls12381Params,
};

/**
 * Type for twisted edwards curve parameters, expected by the `TwistedEdwards`
 * curve factory.
 */
type TwistedEdwardsParams = _TwistedEdwardsParams;

/**
 * Pre-defined twisted edwards curve parameters.
 */
const TwistedEdwardsParams = {
  ed377: ed377Params,
};

/** Factory for the Pallas curve. */
function Pallas() {
  return Weierstraß.create(pallasParams);
}
/** Factory for the BLS12-377 curve. */
function BLS12377() {
  return Weierstraß.create(bls12377Params);
}
/** Factory for the BLS12-381 curve. */
function BLS12381() {
  return Weierstraß.create(bls12381Params);
}
/** Factory for the Edwards-on-BLS12-377 twisted edwards curve. */
function Ed377() {
  return TwistedEdwards.create(ed377Params);
}
