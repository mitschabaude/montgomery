import "../src/extra/fix-webcrypto.js";
import fs from "node:fs/promises";
import { tic, toc } from "../src/extra/tictoc.js";
import { log2 } from "../src/util.js";
import {
  PointVectorInput,
  ScalarVectorInput,
} from "../src/extra/reference.node.js";
import { BytesPoint } from "../src/msm-bls12-zprize.js";

export { load };

let file = "./inputs.json";

(Uint8Array.prototype as any).toJSON = function () {
  return [...this];
};

let isMain = process.argv[1] === import.meta.url.slice(7);
if (isMain) {
  let n = Number(process.argv[2] ?? 14);
  let isLoad = process.argv[3] === "--load" || process.argv[2] === "--load";
  if (!isLoad) {
    await store(n);
  } else {
    tic("load inputs");
    let inputs = await load(n);
    toc();
    console.log(`read 2^${log2(inputs.N)} inputs`);
  }
}

async function store(n: number) {
  tic("create inputs (rust)");
  let points = new PointVectorInput(2 ** n).toJsArray();
  let scalars = new ScalarVectorInput(2 ** n).toJsArray();
  toc();

  let json = JSON.stringify({ scalars, points });
  await fs.writeFile(file, json, "utf-8");
  console.log(`Wrote ${(json.length * 1e-3).toFixed(2)} kB to ${file}`);
}

type LoadedPoint = [xArray: number[], yArray: number[], isInfinity: boolean];

async function load(n: number) {
  let loaded: { scalars: number[]; points: LoadedPoint[] } = JSON.parse(
    await fs.readFile(file, "utf-8")
  );
  let N = loaded.points.length;
  let N0 = 2 ** n;
  if (N0 > N)
    throw Error(`Cannot load 2^${n} points, only have 2^${log2(N)} stored.`);
  let points = loaded.points
    .slice(0, N0)
    .map(
      ([x, y, inf]) => [new Uint8Array(x), new Uint8Array(y), inf] as BytesPoint
    );
  let scalars = loaded.scalars.slice(0, N0).map((s) => new Uint8Array(s));
  return { points, scalars, N };
}
