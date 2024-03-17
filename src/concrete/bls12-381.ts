import type * as _W from "wasmati";
import { Weierstraß } from "../module-weierstrass.js";
import { curveParams } from "./bls12-381.params.js";

export { BLS12381 };

let BLS12381 = await Weierstraß.create(curveParams);
