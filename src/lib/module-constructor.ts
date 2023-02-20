import * as Dependency from "./dependency.js";
import { Export, Import } from "./export.js";
import { Func } from "./func.js";
import { resolveInstruction } from "./instruction.js";
import { Module as Module_ } from "./module.js";
import { FunctionType, functionTypeEquals } from "./types.js";

export { Module };

type Module = Module_;

function ModuleConstructor<Exports extends Record<string, Dependency.Export>>({
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

const Module = Object.assign(ModuleConstructor, Module_);

function pushDependency(
  existing: Set<Dependency.anyDependency>,
  dep: Dependency.anyDependency
) {
  existing.add(dep);
  for (let dep_ of dep.deps) {
    pushDependency(existing, dep_);
  }
}
