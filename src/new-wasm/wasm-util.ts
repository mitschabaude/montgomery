import { Local, br_if, i32, local, loop } from "wasmati";

export { forLoop, forLoop1, forLoop4 };

// helper
function forLoop(
  {
    incr,
    i,
    start,
    end,
  }: {
    incr: number;
    i: Local<i32>;
    start: number | Local<i32>;
    end: number | Local<i32>;
  },
  callback: () => void
) {
  if (typeof start === "number") i32.const(start);
  else local.get(start);
  local.set(i);
  loop({}, () => {
    callback();
    // i += incr
    i32.add(i, incr);
    local.tee(i);
    // (...) !== end
    if (typeof end === "number") {
      i32.const(incr * end);
    } else {
      if (incr === 1) {
        local.get(end);
      } else {
        i32.mul(incr, end);
      }
    }
    i32.ne();
    // if (...) continue
    br_if(0);
  });
}

function forLoop4(
  i: Local<i32>,
  start: number | Local<i32>,
  end: number | Local<i32>,
  callback: () => void
) {
  forLoop({ incr: 4, i, start, end }, callback);
}
function forLoop1(
  i: Local<i32>,
  start: number | Local<i32>,
  end: number | Local<i32>,
  callback: () => void
) {
  forLoop({ incr: 1, i, start, end }, callback);
}
