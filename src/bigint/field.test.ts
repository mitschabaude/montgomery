import assert from "node:assert/strict";
import { Random, test } from "../testing/property.js";
import { exampleFields } from "../concrete/example-fields.js";
import type { BigintField } from "./field.js";

for (let fieldName in exampleFields) {
  testField(fieldName, exampleFields[fieldName as keyof typeof exampleFields]);
}

function testField(label: string, F: BigintField) {
  let p = F.modulus;
  let field = Random.field(p);
  let uniformField = Random(F.random);

  // random
  test.verbose(
    label,
    field,
    field,
    field,
    uniformField,
    (x, y, z, xUniform) => {
      assert.equal(F.add(x, F.negate(x)), 0n, "add & negate");
      assert.equal(F.subtract(F.add(x, y), x), y, "add & sub");

      assert.equal(
        F.multiply(F.multiply(x, y), z),
        F.multiply(x, F.multiply(y, z)),
        "mul associative"
      );
      assert.equal(
        F.multiply(z, F.add(x, y)),
        F.add(F.multiply(z, x), F.multiply(z, y)),
        "mul distributive"
      );

      if (x !== 0n) {
        let xInv = F.inverse(x);
        assert.equal(F.multiply(xInv, x), 1n, "inverse & mul");
      }

      let squareX = F.square(x);
      assert(F.isSquare(squareX), "square + isSquare");
      assert([x, F.negate(x)].includes(F.sqrt(squareX)!), "square + sqrt");

      assert.equal(F.exp(x, 4n), F.square(F.square(x)), "exp");
      assert.equal(
        F.exp(x, y + z),
        F.multiply(F.exp(x, y), F.exp(x, z)),
        "exp & mul"
      );

      if (p >> 250n) {
        assert(xUniform > 1n << 128n, "random x is large");
        assert(xUniform < p - (1n << 128n), "random x is not small negative");
      }
      assert(x >= 0 && x < p, "random x is in range");
    }
  );

  // hard-coded
  // t is computed correctly from p = 2^M * t + 1
  let twoToM = 1n << BigInt(F.M);
  assert(F.t * twoToM + 1n === F.modulus, "t, M are computed correctly");

  // the primitive roots of unity `r` actually satisfy the equations defining them:
  let shouldBe1 = F.exp(F.roots[0], twoToM);
  let shouldBeMinus1 = F.exp(F.roots[0], twoToM >> 1n);
  assert(shouldBe1 === 1n, "r^(2^M) === 1");
  assert(shouldBeMinus1 + 1n === F.modulus, "r^(2^(M-1)) === -1");

  // the primitive roots of unity are non-squares
  // -> verifies that the two-adicity is 32, and that they can be used as non-squares in the sqrt algorithm
  assert(!F.isSquare(F.roots[0]), "roots of unity are non-squares");

  assert.equal(F.subtract(3n, 3n), 0n, "sub");
  assert.equal(F.subtract(3n, 8n), p - 5n, "sub");
  assert.equal(F.add(1n, 1n), 2n, "add");
  assert.equal(F.add(p - 1n, 2n), 1n, "add");
  assert.equal(F.negate(5n), p - 5n, "negate");
  assert.equal(F.multiply(p - 1n, 2n), p - 2n, "mul");
  assert.equal(F.multiply(p - 3n, p - 3n), 9n, "mul");
  assert.equal(F.inverse(1n), 1n, "inverse 1");
  assert.equal(F.inverse(2n), (p + 1n) / 2n, "inverse 2");
  assert.equal(F.inverse(F.negate(2n)), (p - 1n) / 2n, "inverse -2");
  if (p % 3n === 1n) {
    assert.equal(F.inverse(3n), (2n * p + 1n) / 3n, "inverse 3");
  } else {
    assert.equal(F.inverse(3n), (p + 1n) / 3n, "inverse 3");
  }
  assert.equal(F.square(F.negate(10n)), 100n, "square");
  assert.equal(F.exp(F.negate(2n), 3n), F.negate(8n), "exp");
  assert.equal(F.exp(2n, p - 1n), 1n, "exp mod p-1");
  assert.equal(F.exp(2n, p - 1n + 3n), 8n, "exp mod p-1");
  if (F.M >= 2n) {
    assert(F.isSquare(p - 1n), "isSquare -1");
    let i = F.exp(F.roots[0], twoToM >> 2n);
    assert([i, F.negate(i)].includes(F.sqrt(p - 1n)!), "sqrt -1");
  }
  assert.equal(F.mod(-1n), p - 1n, "mod");
  assert.equal(F.mod(p + 1n), 1n, "mod");
  assert(F.isEqual(10n, 10n), "equal");
  assert(F.isEqual(10n, F.mod(p + 10n)), "equal + mod");
  assert(!F.isEqual(5n, p - 5n), "not equal");
}
