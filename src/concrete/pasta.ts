import type * as W from "wasmati";
import { Weierstraß } from "../parallel.ts";
import { pallasParams } from "./pasta.params.ts";

export { Pallas };

let Pallas = await Weierstraß.create(pallasParams);
