import type * as _W from "wasmati";
import { Weierstraß } from "../parallel.ts";
import { curveParams } from "./bls12-381.params.ts";

export { BLS12381 };

let BLS12381 = await Weierstraß.create(curveParams);
