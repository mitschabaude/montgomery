import { randomGenerators } from "../field-util.js";

export { p, q, nBits, nBytes, randomField, randomFieldx2 };

const p = 0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001n;
const q = 0x40000000000000000000000000000000224698fc0994a8dd8c46eb2100000001n;

const nBits = 255;
const nBytes = 32;

const { randomField, randomFieldx2 } = randomGenerators(p);
