import Wabt from "wabt";
import fs from "node:fs/promises";

export { writeWat };

const wabt = await Wabt();

async function writeWat(filename: string, wasmByteCode: Uint8Array) {
  // write wat file for comparison
  let wabtModule = wabt.readWasm(wasmByteCode, wabtFeatures());
  let wat = wabtModule.toText({});
  await writeFile(filename, wat);
}

async function writeFile(fileName: string, content: string | Uint8Array) {
  if (typeof content === "string") {
    await fs.writeFile(fileName, content, "utf8");
  } else {
    await fs.writeFile(fileName, content);
  }
  console.log(`wrote ${(content.length / 1e3).toFixed(1)}kB to ${fileName}`);
}

// wabt features

function wabtFeatures() {
  return {
    /** Experimental exception handling. */
    exceptions: true,
    /** Import/export mutable globals. */
    mutable_globals: true,
    /** Saturating float-to-int operators. */
    sat_float_to_int: true,
    /** Sign-extension operators. */
    sign_extension: true,
    /** SIMD support. */
    simd: true,
    /** Threading support. */
    threads: true,
    /** Multi-value. */
    multi_value: true,
    /** Tail-call support. */
    tail_call: true,
    /** Bulk-memory operations. */
    bulk_memory: true,
    /** Reference types (externref). */
    reference_types: true,
  };
}
