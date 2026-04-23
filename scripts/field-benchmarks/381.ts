import { benchmark } from "./field-benchmark.ts";
import { BLS12381 } from "../../src/index.ts";

await benchmark((await BLS12381()).Field);
