/**
 * The shared memories that the field and scalar modules import, by name. The
 * names and sizes are fixed here, so that modules generated with wasmati and
 * prebuilt modules are instantiated the same way.
 */
export { fieldMemory, scalarMemory, memoryImports, type SharedMemory };

type SharedMemory = { module: string; field: string; pages: number };

const fieldMemory: SharedMemory = {
  module: "montgomery",
  field: "memory",
  pages: 1 << 16,
};
const scalarMemory: SharedMemory = {
  module: "montgomery",
  field: "memory",
  pages: 1 << 14,
};

/** imports with a new shared memory */
function memoryImports({
  module,
  field,
  pages,
}: SharedMemory): WebAssembly.Imports {
  let memory = new WebAssembly.Memory({
    initial: pages,
    maximum: pages,
    shared: true,
  });
  return { [module]: { [field]: memory } };
}
