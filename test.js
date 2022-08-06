import { add, multiply, subtract } from "./src/finite-field.wat.js";
import { field, mod, randomBaseField } from "./src/finite-field.js";
import { getScratchSpace } from "./src/curve.js";

let { p, toWasm, ofWasm } = field;

let [x, y, z, ...scratch] = getScratchSpace(10);

let x0 = randomBaseField() + randomBaseField();
let y0 = randomBaseField() + randomBaseField();
toWasm(x0, x);
toWasm(y0, y);

let z0 = mod(x0 * y0, p);
multiply(z, x, y);
let z1 = ofWasm(scratch, z);
if (z0 !== z1) throw Error("multiply");

z0 = mod(x0 + y0, p);
add(z, x, y);
z1 = ofWasm(scratch, z);

if (z0 !== z1) throw Error("add");

z0 = mod(x0 - y0, p);
subtract(z, x, y);
z1 = ofWasm(scratch, z);

if (z0 !== z1) throw Error("subtract");
