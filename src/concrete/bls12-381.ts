import type * as W from "wasmati";
import { bigintFromBytes, randomBytes } from "../util.js";
import { createGlvScalar } from "../scalar-glv.js";
import { p, beta, lambda, q } from "./bls12-381.params.js";
import { createMsmField } from "../field-msm.js";

export { Scalar, Field, testDecomposeRandomScalar };

const Field = await createMsmField(p, 30, beta);

const Scalar = await createGlvScalar(q, lambda, 29);

function testDecomposeRandomScalar() {
  return Scalar.testDecomposeScalar(randomScalar());
}

function randomScalar() {
  while (true) {
    let bytes = randomBytes(32);
    bytes[31] &= 0x7f;
    let x = bigintFromBytes(bytes);
    if (x < q) return x;
  }
}