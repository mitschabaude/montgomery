import { benchmark } from "./field-benchmark.ts";
import { BLS12377 } from "../../src/index.ts";

await benchmark((await BLS12377()).Field);
