// helper for printing timings

export { tic, toc };

let timingStack = [];

function tic(label) {
  timingStack.push([label, performance.now()]);
}

function toc() {
  let [label, start] = timingStack.pop();
  let time = performance.now() - start;
  if (label) console.log(`${label}... ${time.toFixed(1)}ms`);
  return time;
}
