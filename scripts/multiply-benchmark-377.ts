import { benchmark } from "./multiply-benchmark.js";
import { Field, Random } from "../src/concrete/bls12-377.js";

await benchmark(Field, Random);
