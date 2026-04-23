import { benchmark } from "./field-benchmark.ts";
import { Pallas } from "../../src/index.ts";

await benchmark((await Pallas()).Field, { onlyQuick: false });
