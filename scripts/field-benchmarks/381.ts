import { benchmark } from "./field-benchmark.js";
import { BLS12_381 } from "../../src/concrete/bls12-381.js";

await benchmark(BLS12_381.Field);
