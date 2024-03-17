import type * as _W from "wasmati";
import { Weierstraß } from "../parallel.js";
import { curveParams } from "./bls12-377.params.js";

export { BLS12377, Weierstraß };

let BLS12377 = await Weierstraß.create(curveParams);
