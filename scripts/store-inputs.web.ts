import { BytesPoint } from "../src/msm.js";
import { log2 } from "../src/util.js";
export { load };

let file = "./inputs.json";

type LoadedPoint = [xArray: number[], yArray: number[], isInfinity: boolean];

async function load(n: number) {
  let response = await fetch(file);
  let loaded: { scalars: number[]; points: LoadedPoint[] } =
    await response.json();
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
