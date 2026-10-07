import {
  resolveFieldBackend,
  type FieldBackendOption,
} from "../src/field-layout.ts";
import { assert } from "../src/util.ts";

export { parseMsmArgs };

// <n> <nThreads> [--evaluate] [--backend=auto|29-bit|wide]
function parseMsmArgs() {
  let args = process.argv.slice(2);
  let positional = args.filter((a) => !a.startsWith("--"));
  let n = Number(positional[0] ?? 16);
  let nThreads = Number(positional[1] ?? 16);
  let doEvaluate = args.includes("--evaluate");
  let backend = (args.find((a) => a.startsWith("--backend="))?.slice(10) ??
    "auto") as FieldBackendOption;
  assert(
    ["auto", "29-bit", "wide"].includes(backend),
    `unknown backend ${backend}`
  );
  console.log({ n, nThreads, backend: resolveFieldBackend(backend) });
  return { n, nThreads, doEvaluate, options: { backend } };
}
