import { type CurveParams } from "../bigint/twisted-edwards.ts";
import { createField } from "../bigint/field.ts";
import { mod } from "../bigint/field-util.ts";

export { p, q, h, d, G, ed25519Params };

// base field: 2^255 - 19 (same as Curve25519)
const p = (1n << 255n) - 19n;
// scalar field / group order
const q = (1n << 252n) + 0x14def9dea2f79cd65812631a5cf5d3edn;

const h = 8n;

// Ed25519 twisted Edwards equation: -x^2 + y^2 = 1 + d*x^2*y^2
// where d = -121665 / 121666 mod p
const Fp = createField(p);
const d = Fp.multiply(Fp.negate(121665n), Fp.inverse(121666n));

// standard Ed25519 base point (RFC 8032)
const G = {
  x: 15112221349535400772501151409588531511454012693041857206046113283949847762202n,
  y: 46316835694926478169428394003475163141307993866256225615783033603165251855960n,
  isInfinity: false,
};

// sanity check: G is on the curve
{
  const lhs = mod(-(G.x * G.x) + G.y * G.y, p);
  const rhs = mod(1n + d * G.x * G.x * G.y * G.y, p);
  if (lhs !== rhs) throw Error("ed25519: generator not on curve");
}

const ed25519Params: CurveParams = {
  label: "ed25519",
  modulus: p,
  order: q,
  cofactor: h,
  d,
  generator: G,
};
