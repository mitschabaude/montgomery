// helper for printing timings

export { tic, toc };

let timingStack = [];
let i = 0;

function tic(label = `Run command ${i++}`) {
  console.log(`${label}... `);
  timingStack.push([label, Date.now()]);
}

function toc() {
  let [label, start] = timingStack.pop();
  let time = Date.now() - start;
  console.log(`\r${label}... ${time.toFixed(1)}ms\n`);
  return time;
}
