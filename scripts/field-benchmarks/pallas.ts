import { benchmark } from "./field-benchmark.js";
import { Field, Random } from "../../src/concrete/pasta.js";

await benchmark(Field, Random);
