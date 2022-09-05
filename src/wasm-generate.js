import { toBase64 } from "fast-base64";

export {
  Writer,
  compileWat,
  interpretWat,
  block,
  func,
  loop,
  forLoop8,
  forLoop1,
  addExport,
  addFuncExport,
  ops,
};

let ops = getOperations();

function Writer(initial = "") {
  let indent = "";
  let text = initial;
  let write = (l) => {
    w.text += l;
  };
  let remove = (n) => {
    w.text = w.text.slice(0, w.text.length - n);
  };
  let spaces = (n) => {
    let n0 = w.indent.length;
    if (n > n0) write(" ".repeat(n - n0));
    if (n < n0) remove(n0 - n);
    w.indent = " ".repeat(n);
  };
  let tab = () => spaces(w.indent.length + 2);
  let untab = () => spaces(w.indent.length - 2);

  let line = (...args) => {
    args.forEach((arg) => {
      if (typeof arg === "function" || typeof arg === "object") {
        console.log("Cannot print", arg);
        throw Error(
          `writer.line(): Cannot print argument of type ${typeof arg}`
        );
      }
    });
    w.text += args.join(" ") + "\n" + w.indent;
  };
  let lines = (...args) => {
    args.forEach((arg) => line(arg));
    // line();
  };
  let wrap = (callback) => (w.text = callback(w.text));
  let comment = (s = "") => line(";; " + s);

  let w = {
    text,
    indent,
    exports: new Set(),
    imports: {},
    write,
    remove,
    spaces,
    tab,
    untab,
    line,
    lines,
    wrap,
    comment,
    join: (...args) => args.join(" "),
  };
  return w;
}

function op(name) {
  return function (...args) {
    if (args.length === 0) return name;
    else return `(${name} ${args.join(" ")})`;
  };
}
function block(name) {
  return function (writer, args, callback) {
    writer.line(`(${name} ${args.join(" ")}`);
    writer.tab();
    callback();
    writer.untab();
    writer.line(")");
  };
}

function getOperations() {
  function int(bits) {
    let constOp = (a) => {
      let op_ = op(`i${bits}.const`);
      if (typeof a === "string" || a <= 255) return op_(String(a));
      return op_(`0x` + a.toString(16));
    };
    let mapArgs = (args) =>
      args.map((a) =>
        typeof a === "number" || typeof a === "bigint"
          ? constOp(a)
          : typeof a === "string" && a[0] === "$"
          ? op("local.get")(a)
          : a
      );
    function iOp(name) {
      let op_ = op(`i${bits}.${name}`);
      return (...args) => op_(...mapArgs(args));
    }
    return {
      const: constOp,
      load: iOp("load"),
      store: iOp("store"),
      mul: iOp("mul"),
      add: iOp("add"),
      and: iOp("and"),
      or: iOp("or"),
      shr_u: iOp("shr_u"),
      shl: iOp("shl"),
      eq: iOp("eq"),
      ne: iOp("ne"),
      eqz: iOp("eqz"),
    };
  }
  return {
    i64: int(64),
    i32: int(32),
    local: Object.assign(op("local"), {
      get: op("local.get"),
      set: op("local.set"),
      tee: op("local.tee"),
    }),
    local32: (name) => op("local")(name, "i32"),
    local64: (name) => op("local")(name, "i64"),
    br_if: op("br_if"),
    param: op("param"),
    param32: (name) => op("param")(name, "i32"),
    param64: (name) => op("param")(name, "i64"),
    result: op("result"),
    export: (name, ...args) => op("export")(`"${name}"`, ...args),
    call: (name, ...args) => op("call")("$" + name, ...args),
    memory: (name, ...args) => op("memory")("$" + name, ...args),
    func: (name, ...args) => op("func")("$" + name, ...args),
  };
}

function func(writer, name, args, callback) {
  block("func")(writer, ["$" + name, ...args], callback);
}
function addExport(W, name, thing) {
  W.exports.add(name);
  W.line(ops.export(name, thing));
}
function addFuncExport(W, name) {
  W.exports.add(name);
  W.line(ops.export(name, ops.func(name)));
}

function forLoop8(writer, i, i0, length, callback) {
  let { local, i32, br_if } = ops;
  writer.line(local.set(i, i32.const(i0)));
  loop(writer, () => {
    callback();
    writer.line(br_if(0, i32.ne(8 * length, local.tee(i, i32.add(i, 8)))));
  });
}

function forLoop1(writer, i, i0, length, callback) {
  let { local, i32, br_if } = ops;
  writer.line(local.set(i, i32.const(i0)));
  loop(writer, () => {
    callback();
    writer.line(br_if(0, i32.ne(length, local.tee(i, i32.add(i, 1)))));
  });
}

function loop(writer, callback) {
  block("loop")(writer, [], callback);
}

let wabt;

async function compileWat({ text, exports }) {
  // TODO: imports
  let wat = text;
  wabt ??= await (await import("wabt")).default();
  let wabtModule = wabt.parseWat("", wat, wasmFeatures);
  let wasmBytes = new Uint8Array(
    wabtModule.toBinary({ write_debug_names: true }).buffer
  );
  let base64 = await toBase64(wasmBytes);
  return `// compiled from wat
import { toBytes } from 'fast-base64';
let wasmBytes = await toBytes("${base64}");
let { instance } = await WebAssembly.instantiate(wasmBytes, {});
let { ${[...exports].join(", ")} } = instance.exports;
export { ${[...exports].join(", ")} };
`;
}

async function interpretWat({ text }) {
  // TODO: imports
  let wat = text;
  wabt ??= await (await import("wabt")).default();
  let wabtModule = wabt.parseWat("", wat, wasmFeatures);
  let wasmBytes = new Uint8Array(
    wabtModule.toBinary({ write_debug_names: true }).buffer
  );
  let { instance } = await WebAssembly.instantiate(wasmBytes, {});
  return instance.exports;
}

const wasmFeatures = {
  exceptions: true,
  mutable_globals: true,
  sat_float_to_int: true,
  sign_extension: true,
  simd: true,
  threads: true,
  multi_value: true,
  tail_call: true,
  bulk_memory: true,
  reference_types: true,
  annotations: true,
  gc: true,
};
