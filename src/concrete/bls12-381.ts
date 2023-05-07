import type * as W from "wasmati";
import { bigintFromBytes, randomBytes } from "../util.js";
import { createGlvScalar } from "../glv-scalar.js";
import { lambda, q } from "./bls12-381.params.js";

export { Scalar, testDecomposeRandomScalar };

const w = 29;
const Scalar = await createGlvScalar(q, lambda, w);

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
