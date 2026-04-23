import { benchmark } from "./field-benchmark.ts";
import { BLS12377 } from "../../src/concrete/bls12-377.ts";

await benchmark(BLS12377.Field);
