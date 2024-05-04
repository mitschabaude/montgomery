import { benchmark } from "./field-benchmark.js";
import { BLS12377 } from "../../src/concrete/bls12-377.js";

await benchmark(BLS12377.Field);
