export {
  Writer,
  block,
  func,
  loop,
  if_,
  module,
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
    args.filter((l) => !!l || l === "").forEach((arg) => line(arg));
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

/**
 *
 * @param {string} name
 * @returns
 */
function op(name) {
  return function (...args) {
    if (args.length === 0) return name;
    else
      return `(${name} ${args
        .filter((a) => a != undefined && a !== "")
        .join(" ")})`;
  };
}
function blockOp(name) {
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
      load: (from, { offset = 0 } = {}) =>
        iOp("load")(`offset=${offset}`, from),
      store: (to, value, { offset = 0 } = {}) =>
        iOp("store")(`offset=${offset}`, to, value),
      mul: iOp("mul"),
      add: iOp("add"),
      sub: iOp("sub"),
      and: iOp("and"),
      or: iOp("or"),
      not: iOp("not"),
      shr_u: iOp("shr_u"),
      shl: iOp("shl"),
      eq: iOp("eq"),
      ne: iOp("ne"),
      eqz: iOp("eqz"),
      lt_u: iOp("lt_u"),
      gt_u: iOp("gt_u"),
      ctz: iOp("ctz"),
      clz: iOp("clz"),
    };
  }
  let i64 = int(64);
  let i32 = { ...int(32), wrap_i64: op("i32.wrap_i64") };
  return {
    i64,
    i32,
    local: Object.assign(op("local"), {
      get: op("local.get"),
      set: op("local.set"),
      tee: op("local.tee"),
    }),
    local32: (name) => op("local")(name, "i32"),
    local64: (name) => op("local")(name, "i64"),
    global: Object.assign(op("global"), {
      get: op("global.get"),
      set: op("global.set"),
    }),
    global32: (name, value) => op("global")(name, "i32", i32.const(value)),
    global32Mut: (name, value) =>
      op("global")(name, "(mut i32)", i32.const(value)),
    global64: (name, value) => op("global")(name, "i64", i64.const(value)),
    global64Mut: (name, value) =>
      op("global")(name, "(mut i64)", i64.const(value)),
    br_if: op("br_if"),
    br: op("br"),
    param: op("param"),
    param32: (name) => op("param")(name, "i32"),
    param64: (name) => op("param")(name, "i64"),
    result: op("result"),
    result32: op("result")("i32"),
    result64: op("result")("i64"),
    export: (name, ...args) => op("export")(`"${name}"`, ...args),
    call: (name, ...args) => op("call")("$" + name, ...args),
    memory: Object.assign(
      (name, ...args) => op("memory")("$" + name, ...args),
      {
        /**
         * @param {number} target
         * @param {number} source
         * @param {number} length length in bytes
         */
        copy: (target, source, length) =>
          op("memory.copy")(target, source, length),
        fill: op("memory.fill"),
      }
    ),
    func: (name, ...args) => op("func")("$" + name, ...args),
    return_: op("return"),
  };
}

function func(writer, name, args, callback) {
  blockOp("func")(writer, ["$" + name, ...args], callback);
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
  blockOp("loop")(writer, [], callback);
}
function block(writer, callback) {
  blockOp("block")(writer, [], callback);
}
function module(writer, callback) {
  blockOp("module")(writer, [], callback);
}
function if_(writer, callback) {
  let oldText = writer.text;
  callback();
  let newText = writer.text.slice(oldText.length);
  writer.text = oldText;
  let lines = newText
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s);
  if (lines.length === 1) {
    writer.line(`if ${lines[0]} end`);
  } else {
    writer.line("if");
    writer.tab();
    writer.lines(...lines);
    writer.untab();
    writer.line("end");
  }
}
