/**
 * MSM implementation that only relies on the most basic curve interface: add, double, zero.
 *
 * We use this for Twisted Edwards curves which have neither endomorphisms nor a cheap batched addition algorithm.
 */
import { MsmField } from "./field-msm.js";
import { Scalar } from "./scalar-simple.js";
import { log2 } from "./util.js";

export { msmBasic };

type MsmInputCurve = {
  Field: MsmField;
  Scalar: Scalar;
  Curve: {
    size: number;
    setZero: (P: number) => void;
    addAssign: (scratch: number[], P1: number, P2: number) => void;
    doubleInPlace: (scratch: number[], P: number) => void;
    copy: (target: number, source: number) => void;
  };
};

async function msmBasic(
  { Field, Scalar, Curve }: MsmInputCurve,
  inputScalarPtr: number,
  inputPointPtr: number,
  N: number
) {
  let b = Scalar.sizeInBits;
  let n = log2(N);
  let c = Math.max(n - 1, 1); // window size
}
