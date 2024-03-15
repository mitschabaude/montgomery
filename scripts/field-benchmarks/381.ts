import { benchmark } from "./field-benchmark.js";
import { Field, Random } from "../../src/concrete/bls12-381.js";

await benchmark(Field, Random);
