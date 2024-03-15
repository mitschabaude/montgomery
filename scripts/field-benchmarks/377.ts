import { benchmark } from "./field-benchmark.js";
import { BLS12_377 } from "../../src/concrete/bls12-377.js";

await benchmark(BLS12_377.Field);
