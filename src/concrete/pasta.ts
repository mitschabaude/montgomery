import type * as W from "wasmati";
import { Weierstraß } from "../module-weierstrass.js";
import { pallasParams } from "./pasta.params.js";

export { Pallas };

let Pallas = await Weierstraß.create(pallasParams);
