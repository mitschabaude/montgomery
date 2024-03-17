import type * as _W from "wasmati";
import { curveParams } from "./ed-on-bls12-377.params.js";
import { TwistedEdwards } from "../parallel.js";

export { Ed377, TwistedEdwards };

let Ed377 = await TwistedEdwards.create(curveParams);
