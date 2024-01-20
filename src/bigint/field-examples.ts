import { createField } from "./field.js";
import { p as pPasta, q as qPasta } from "../concrete/pasta.params.js";
import {
  p as pBls12_381,
  q as qBls12_381,
} from "../concrete/bls12-381.params.js";
import {
  p as pBls12_377,
  q as qBls12_377,
} from "../concrete/bls12-377.params.js";

export { exampleFields };

// some primes
let pSmall = 101n;
let pBabybear = (1n << 31n) - 1n;
let pGoldilocks = (1n << 64n) - (1n << 32n) + 1n;
let p25519 = (1n << 255n) - 19n;
let pSecp256k1 = (1n << 256n) - (1n << 32n) - 0b1111010001n;
let pSecq256k1 = (1n << 256n) - 0x14551231950b75fc4402da1732fc9bebfn;

let exampleFields = {
  pastaFp: createField(pPasta),
  pastaFq: createField(qPasta),
  small: createField(pSmall),
  babybear: createField(pBabybear),
  goldilocks: createField(pGoldilocks),
  f25519: createField(p25519),
  secp256k1: createField(pSecp256k1),
  secq256k1: createField(pSecq256k1),
  bls12_381_base: createField(pBls12_381),
  bls12_381_scalar: createField(qBls12_381),
  bls12_377_base: createField(pBls12_377),
  bls12_377_scalar: createField(qBls12_377),
};
