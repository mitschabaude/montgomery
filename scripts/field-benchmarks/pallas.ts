import { benchmark } from "./field-benchmark.ts";
import { Pallas } from "../../src/concrete/pasta.ts";

await benchmark(Pallas.Field, { onlyQuick: false });
