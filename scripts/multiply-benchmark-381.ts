import { benchmark } from "./multiply-benchmark.js";
import { Field, Random } from "../src/concrete/bls12-381.js";

await benchmark(Field, Random);
