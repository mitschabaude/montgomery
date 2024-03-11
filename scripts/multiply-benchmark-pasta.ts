import { benchmark } from "./multiply-benchmark.js";
import { Field, Random } from "../src/concrete/pasta.js";

await benchmark(Field, Random);
