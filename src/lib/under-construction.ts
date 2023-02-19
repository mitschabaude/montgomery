import * as Dependency from "./dependency.js";
import { Export, Import } from "./export.js";
import { Instruction, resolveInstruction, ToValueType } from "./instruction.js";
import type { Module as Module_ } from "./module.js";
import {
  FunctionIndex,
  FunctionType,
  functionTypeEquals,
  TypeIndex,
  valueType,
  ValueType,
} from "./types.js";

// external
export { Module, func };
// internal
export { pushInstruction, LocalContext, emptyContext, Func };

type Module = Module_;

function Module<Exports extends Record<string, Dependency.Export>>({
  exports: inputExports,
}: {
  exports: Exports;
}): Module {
  // collect all dependencies (by kind)
  let dependencies = new Set<Dependency.t>();
  for (let name in inputExports) {
    pushDependency(dependencies, inputExports[name]);
  }
  let dependencyByKind: Partial<{
    [K in Dependency.t["kind"]]: (Dependency.t & { kind: K })[];
  }> = {};
  for (let dep of dependencies) {
    (dependencyByKind[dep.kind] ??= []).push(dep as any);
  }
  let depToIndex = new Map<Dependency.t, number>();
  // types / funcs / imports
  // first types from imported functions, then from other functions,
  let types: FunctionType[] = [];
  let imports: Import[] = [];
  let nImportFuncs = 0;
  let funcs0: (Dependency.Func & { typeIndex: number; funcIndex: number })[] =
    [];
  for (let importDep of dependencyByKind.importFunction ?? []) {
    let { type, module, string } = importDep;
    let typeIndex = types.findIndex((t) => functionTypeEquals(t, type));
    if (typeIndex === -1) {
      typeIndex = types.length;
      types.push(type);
    }
    let description = { kind: "function" as const, value: typeIndex };
    let funcIndex = nImportFuncs++;
    imports.push({ module, name: string, description });
    depToIndex.set(importDep, funcIndex);
  }
  for (let func of dependencyByKind.function ?? []) {
    let typeIndex = types.findIndex((t) => functionTypeEquals(t, func.type));
    if (typeIndex === -1) {
      typeIndex = types.length;
      types.push(func.type);
    }
    let funcIndex = nImportFuncs + funcs0.length;
    funcs0.push({ ...func, typeIndex, funcIndex });
    depToIndex.set(func, funcIndex);
  }
  for (let type of dependencyByKind.type ?? []) {
    let typeIndex = types.findIndex((t) => functionTypeEquals(t, type.type));
    if (typeIndex === -1) {
      typeIndex = types.length;
      types.push(type.type);
    }
    depToIndex.set(type, typeIndex);
  }

  let funcs: Func[] = funcs0.map(({ typeIndex, funcIndex, ...func }) => {
    let body = func.body.map((instr) => resolveInstruction(instr, depToIndex));
    return {
      body,
      functionIndex: funcIndex,
      typeIndex,
      locals: func.locals,
      type: func.type,
    };
  });

  let exports: Export[] = [];
  for (let name in inputExports) {
    let exp = inputExports[name];
    if (exp.kind === "function" || exp.kind === "importFunction") {
      let funcIndex = depToIndex.get(exp)!;
      exports.push({
        name,
        description: { kind: "function", value: funcIndex },
      });
    } else {
      throw Error("non-function exports unimplemented");
    }
  }
  return {
    types,
    funcs,
    imports,
    exports,
    // TODO
    datas: [],
    elems: [],
    tables: [],
    globals: [],
    memory: undefined,
    start: undefined,
  };
}

function pushDependency(
  existing: Set<Dependency.anyDependency>,
  dep: Dependency.anyDependency
) {
  existing.add(dep);
  for (let dep_ of dep.deps) {
    pushDependency(existing, dep_);
  }
}

function func<
  Args extends Record<string, ValueType>,
  Locals extends Record<string, ValueType>,
  Results extends ValueType[]
>(
  ctx: LocalContext,
  {
    in: args,
    locals,
    out: results,
  }: {
    in: Args;
    locals: Locals;
    out: Results;
  },
  run: (args: ToLocal<Args>, locals: ToLocal<Locals>) => void
): Dependency.Func {
  ctx.stack = [];
  let argsArray = Object.values(args).map((arg) => valueType(arg.kind));
  let localsArray = Object.values(locals).map((arg) => valueType(arg.kind));
  let resultsArray = results.map((arg) => valueType(arg.kind));
  let type = { args: argsArray, results: resultsArray };
  initializeContext(ctx, [...argsArray, ...localsArray], resultsArray);
  let nArgs = argsArray.length;
  let argsInput = Object.fromEntries(
    Object.entries(args).map(([key], index) => [key, { index }])
  ) as ToLocal<Args>;
  let localsInput = Object.fromEntries(
    Object.entries(locals).map(([key], index) => [
      key,
      { index: index + nArgs },
    ])
  ) as ToLocal<Locals>;
  run(argsInput, localsInput);
  popStack(ctx.stack, results);
  // TODO nice error
  if (ctx.stack.length !== 0) throw Error("expected stack to be empty");
  let { body, deps } = ctx;
  initializeContext(ctx, [], []);
  return { kind: "function", type, body, deps, locals: localsArray };
}

type ToLocal<T extends Record<string, ValueType>> = {
  [K in keyof T]: { type?: ToValueType<T[K]>; index: number };
};

type LocalContext = {
  // func: Dependency.Func; // inline / simplify like in the validation spec
  locals: ValueType[];
  deps: Dependency.t[];
  body: Dependency.Instruction[];
  stack: ValueType[];
  return: ValueType[]; // TODO
  // TODO blocks
};

function emptyContext(): LocalContext {
  return { locals: [], body: [], deps: [], return: [], stack: [] };
}

function initializeContext(
  ctx: LocalContext,
  locals: ValueType[],
  results: ValueType[]
) {
  ctx.locals = locals;
  ctx.return = results;
  ctx.body = [];
  ctx.deps = [];
  ctx.stack = [];
}

function pushInstruction(
  { stack, body, deps }: LocalContext,
  instr: Dependency.Instruction
) {
  popStack(stack, instr.type.args);
  pushStack(stack, instr.type.results);
  body.push(instr);
  for (let dep of instr.deps) {
    if (!deps.includes(dep)) {
      deps.push(dep);
    }
  }
}

function popStack(stack: ValueType[], values: ValueType[]) {
  // TODO nicer errors, which display entire stack vs entire instruction signature
  for (let value of values) {
    let stackValue = stack.pop()!;
    if (value.kind !== stackValue.kind) {
      throw Error(
        `expected ${value.kind} on the stack, got ${stackValue.kind}`
      );
    }
  }
}

function pushStack(stack: ValueType[], values: ValueType[]) {
  stack.push(...values);
}

type Func = {
  functionIndex: FunctionIndex;
  typeIndex: TypeIndex;
  type: FunctionType;
  locals: ValueType[];
  body: Instruction[];
};
