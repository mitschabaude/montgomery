import { bigintToBytes } from "./util.js";

/**
 *
 * @param {bigint} x0
 */
function printBigintAs12Legs(x0) {
  let bytes = bigintToBytes(x0, 48);
  let str = `    ;; 0x${x0.toString(16)}\n`;
  for (let i = 0, k = 0; i < 12; i++) {
    let line = "";
    for (let j = 0; j < 4; j++, k++) {
      line += `\\${bytes[k].toString(16).padStart(2, "0")}`;
    }
    line += "\\00\\00\\00\\00";
    str += `    "${line}"\n`;
  }
  return str;
}

function printBigintAsConstI64(x0, name) {
  let bytes = bigintToBytes(x0, 48);
  let str = `;; $${name} = 0x${x0.toString(16)}\n`;
  for (let i = 0; i < 12; i++) {
    let leg = "";
    for (let j = 0; j < 4; j++) {
      leg += `${bytes[(i + 1) * 4 - j - 1].toString(16).padStart(2, "0")}`;
    }
    str += `(global $${name}_${i} i64 (i64.const 0x${leg}))\n`;
  }
  return str;
}

let p =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
let R = 1n << 384n;

console.log("p");
console.log(printBigintAs12Legs(p));
console.log("2p");
console.log(printBigintAs12Legs(2n * p));
console.log("R - 2p");
console.log(printBigintAs12Legs(R - 2n * p));

console.log("p");
console.log(printBigintAsConstI64(p, "p"));
console.log("2p");
console.log(printBigintAsConstI64(2n * p, "p2"));
console.log("R - 2p");
console.log(printBigintAsConstI64(R - 2n * p, "rm2p"));
