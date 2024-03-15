import type * as _W from "wasmati";
import { Weierstraß } from "../module-weierstrass.js";
import { curveParams } from "./bls12-377.params.js";

export { BLS12_377 };

let BLS12_377 = await Weierstraß.create(curveParams);
