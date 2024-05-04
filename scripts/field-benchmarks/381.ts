import { benchmark } from "./field-benchmark.js";
import { BLS12381 } from "../../src/concrete/bls12-381.js";

await benchmark(BLS12381.Field);
