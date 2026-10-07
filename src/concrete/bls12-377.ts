import type * as _W from "wasmati";
import { Weierstraß } from "../generate.ts";
import { curveParams } from "./bls12-377.params.ts";

export { BLS12377, Weierstraß };

let BLS12377 = await Weierstraß.create(curveParams);
