import { benchmark } from "./field-benchmark.js";
import { Field, Random } from "../../src/concrete/bls12-377.js";

await benchmark(Field, Random);
