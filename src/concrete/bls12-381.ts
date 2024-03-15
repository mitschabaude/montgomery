import type * as _W from "wasmati";
import { Weierstraß } from "../module-weierstrass.js";
import { curveParams } from "./bls12-381.params.js";

export { BLS12_381 };

let BLS12_381 = await Weierstraß.create(curveParams);
