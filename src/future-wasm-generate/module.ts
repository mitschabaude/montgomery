import * as Dependency from "./dependency.js";
import { Export, Import } from "./export.js";
import { Func, JSFunctionType } from "./func.js";
import { resolveInstruction } from "./instruction/instruction.js";
import { Module as BinableModule } from "./module-binable.js";
import { Global } from "./memory-binable.js";
import { FunctionType, functionTypeEquals } from "./types.js";

export { Module };

type Module = BinableModule;

function ModuleConstructor<Exports extends Record<string, Dependency.Export>>({
  exports: inputExports,
}: {
  exports: Exports;
}) {
  // collect all dependencies (by kind)
  let dependencies = new Set<Dependency.t>();
  for (let name in inputExports) {
    pushDependency(dependencies, inputExports[name]);
  }
  let dependencyByKind: {
    [K in Dependency.t["kind"]]: (Dependency.t & { kind: K })[];
  } = Object.fromEntries(
    Dependency.dependencyKinds.map((key) => [key, []])
  ) as any;
  for (let dep of dependencies) {
    (dependencyByKind[dep.kind] as Dependency.t[]).push(dep);
  }
  let depToIndex = new Map<Dependency.t, number>();

  // process imports, along with types of imported functions
  let imports: Import[] = [];
  let importMap: WebAssembly.Imports = {};
  let types: FunctionType[] = [];

  dependencyByKind.importFunction.forEach((func, funcIdx) => {
    let typeIdx = pushType(types, func.type);
    let description = { kind: "function" as const, value: typeIdx };
    depToIndex.set(func, funcIdx);
    let imp = addImport(func, description, funcIdx, importMap);
    imports.push(imp);
  });
  dependencyByKind.importGlobal.forEach((global, globalIdx) => {
    depToIndex.set(global, globalIdx);
    let description = { kind: "global" as const, value: global.type };
    let imp = addImport(global, description, globalIdx, importMap);
    imports.push(imp);
  });

  // funcs + their types
  let funcs0: (Dependency.Func & { typeIdx: number; funcIdx: number })[] = [];
  let nImportFuncs = dependencyByKind.importFunction.length;
  for (let func of dependencyByKind.function) {
    let typeIdx = pushType(types, func.type);
    let funcIdx = nImportFuncs + funcs0.length;
    funcs0.push({ ...func, typeIdx, funcIdx });
    depToIndex.set(func, funcIdx);
  }

  // other types
  for (let type of dependencyByKind.type) {
    let typeIdx = pushType(types, type.type);
    depToIndex.set(type, typeIdx);
  }

  // globals
  let nImportGlobals = dependencyByKind.importGlobal.length;
  dependencyByKind.global.forEach((global, globalIdx) =>
    depToIndex.set(global, globalIdx + nImportGlobals)
  );

  // finalize functions
  let funcs: Func[] = funcs0.map(({ typeIdx, funcIdx, ...func }) => {
    let body = func.body.map((instr) => resolveInstruction(instr, depToIndex));
    return {
      body,
      functionIndex: funcIdx,
      typeIndex: typeIdx,
      locals: func.locals,
      type: func.type,
    };
  });
  // finalize globals
  let globals: Global[] = dependencyByKind.global.map(({ type, init }) => {
    let init_ = [resolveInstruction(init, depToIndex)];
    return { type, init: init_ };
  });

  // exports
  let exports: Export[] = [];
  for (let name in inputExports) {
    let exp = inputExports[name];
    let kind = Dependency.kindToExportKind[exp.kind];
    let value = depToIndex.get(exp)!;
    exports.push({ name, description: { kind, value } });
  }
  let binableModule: BinableModule = {
    types,
    funcs,
    imports,
    exports,
    // TODO
    datas: [],
    elems: [],
    tables: [],
    globals,
    memory: undefined,
    start: undefined,
  };
  let module = {
    module: binableModule,
    importMap,
    async instantiate() {
      let wasmByteCode = Module.toBytes(binableModule);
      return (await WebAssembly.instantiate(
        Uint8Array.from(wasmByteCode),
        importMap
      )) as {
        instance: WebAssembly.Instance & { exports: NiceExports<Exports> };
        module: WebAssembly.Module;
      };
    },
  };
  return module;
}

type NiceExports<Exports extends Record<string, Dependency.Export>> = {
  [K in keyof Exports]: NiceExport<Exports[K]>;
};
type NiceExport<Export extends Dependency.Export> =
  Export extends Dependency.AnyFunc
    ? JSFunctionType<Export["type"]>
    : Export extends Dependency.AnyGlobal
    ? WebAssembly.Global
    : Export extends Dependency.AnyMemory
    ? WebAssembly.Memory
    : Export extends Dependency.AnyTable
    ? WebAssembly.Table
    : unknown;

const Module = Object.assign(ModuleConstructor, BinableModule);

function pushDependency(
  existing: Set<Dependency.anyDependency>,
  dep: Dependency.anyDependency
) {
  existing.add(dep);
  for (let dep_ of dep.deps) {
    pushDependency(existing, dep_);
  }
}

function pushType(types: FunctionType[], type: FunctionType) {
  let typeIndex = types.findIndex((t) => functionTypeEquals(t, type));
  if (typeIndex === -1) {
    typeIndex = types.length;
    types.push(type);
  }
  return typeIndex;
}

function addImport(
  { kind, module = "*", string, value }: Dependency.AnyImport,
  description: Import["description"],
  i: number,
  importMap: WebAssembly.Imports
): Import {
  let prefix = {
    importFunction: "f",
    importGlobal: "g",
    importMemory: "m",
    importTable: "t",
  }[kind];
  string ??= `${prefix}${i}`;
  let import_ = { module, name: string, description };
  let importModule = (importMap[module] ??= {});
  if (string in importModule && importModule[string] !== value) {
    throw Error(
      `Overwriting import "${module}" > "${string}" with different value. Use the same value twice instead.`
    );
  }
  importModule[string] = value;
  return import_;
}
