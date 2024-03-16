import type * as _W from "wasmati";
import { TwistedEdwards } from "../module-twisted-edwards.js";
import { curveParams } from "./ed-on-bls12-377.params.js";

export { Ed377, TwistedEdwards };

let Ed377 = await TwistedEdwards.create(curveParams);
