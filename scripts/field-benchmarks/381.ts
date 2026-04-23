import { benchmark } from "./field-benchmark.ts";
import { BLS12381 } from "../../src/concrete/bls12-381.ts";

await benchmark(BLS12381.Field);
