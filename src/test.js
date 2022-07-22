import { add, emptyField, multiply, subtract } from "./finite-field.wat.js";
import { field, mod, randomBaseField } from "./finite-field.js";

let { p, toWasm, ofWasm } = field;

let x0 = randomBaseField() + randomBaseField();
let y0 = randomBaseField() + randomBaseField();
let x = toWasm(x0);
let y = toWasm(y0);
let z = emptyField();

let z0 = mod(x0 * y0, p);
multiply(z, x, y);
let z1 = ofWasm(z);
if (z0 !== z1) throw Error("multiply");

z0 = mod(x0 + y0, p);
add(z, x, y);
z1 = ofWasm(z);

if (z0 !== z1) throw Error("add");

z0 = mod(x0 - y0, p);
subtract(z, x, y);
z1 = ofWasm(z);

if (z0 !== z1) throw Error("subtract");
