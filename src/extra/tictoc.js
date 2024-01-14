// helper for printing timings

import { isMain } from "../threads/threads.js";

export { tic, toc };

let timingStack = [];

function tic(label) {
  if (!isMain()) return;
  if (label !== undefined) process.stdout.write(`${label}... `);
  timingStack.push([label, performance.now()]);
}

function toc() {
  if (!isMain()) return 0;
  let [label, start] = timingStack.pop();
  let time = performance.now() - start;
  if (label !== undefined)
    process.stdout.write(`\r${label}... ${time.toFixed(1)}ms\n`);
  return time;
}
