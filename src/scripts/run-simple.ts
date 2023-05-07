import { tic, toc } from "../extra/tictoc.js";
import { load } from "./store-inputs.js";
import { webcrypto } from "node:crypto";
import { msmAffine } from "../msm.js";
// web crypto compat
if (Number(process.version.slice(1, 3)) < 19)
  (globalThis as any).crypto = webcrypto;

let n = Number(process.argv[2] || 16);
console.log(`running msm with 2^${n} = ${2 ** n} inputs`);

tic("warm-up JIT compiler with fixed set of points");
{
  let { points, scalars } = await load(14);
  msmAffine(scalars, points);
  await new Promise((r) => setTimeout(r, 100));
  msmAffine(scalars, points);
}
toc();

tic("load inputs & convert to rust");
let { points, scalars } = await load(n);
toc();

tic("msm (ours)");
msmAffine(scalars, points);
toc();
