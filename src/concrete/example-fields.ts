import { createField } from "../bigint/field.ts";
import { p as pPasta, q as qPasta } from "./pasta.params.ts";
import { p as pBls12381, q as qBls12381 } from "./bls12-381.params.ts";
import { p as pBls12377 } from "./bls12-377.params.ts";
import {
  p as pEdBls12377,
  q as qEdBls12377,
} from "./ed-on-bls12-377.params.ts";
import { bn254Params } from "./bn254.params.ts";

export { exampleFields };

let pSmall = 101n;
let pM31 = (1n << 31n) - 1n;
let pBabybear = (1n << 31n) - (1n << 27n) + 1n;
let pGoldilocks = (1n << 64n) - (1n << 32n) + 1n;
let p25519 = (1n << 255n) - 19n;
let pSecp256k1 = (1n << 256n) - (1n << 32n) - 0b1111010001n;
let pSecq256k1 = (1n << 256n) - 0x14551231950b75fc4402da1732fc9bebfn;

// ed25519 scalar field order (for completeness; base field is f25519 above)
let qEd25519 =
  (1n << 252n) + 0x14def9dea2f79cd65812631a5cf5d3edn;

let exampleFields = {
  pastaFp: createField(pPasta),
  pastaFq: createField(qPasta),
  small: createField(pSmall),
  m31: createField(pM31),
  babybear: createField(pBabybear),
  goldilocks: createField(pGoldilocks),
  f25519: createField(p25519),
  ed25519Scalar: createField(qEd25519),
  secp256k1: createField(pSecp256k1),
  secq256k1: createField(pSecq256k1),
  bn254: createField(bn254Params.modulus),
  bn254Scalar: createField(bn254Params.order),
  bls12381: createField(pBls12381),
  bls12381Scalar: createField(qBls12381),
  bls12377: createField(pBls12377),
  // bls12377Scalar: createField(qBls12377), // same as edBls12377
  edBls12377: createField(pEdBls12377),
  edBls12377Scalar: createField(qEdBls12377),
};
