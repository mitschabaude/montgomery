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
  let time = (performance.now() - start) / 1000;
  if (label !== undefined)
    process.stdout.write(`\r${label}... ${time.toFixed(3)} sec\n`);
  return time;
}
