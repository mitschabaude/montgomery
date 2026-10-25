/**
 * BigInt reference arithmetic for the two GF(2^128) presentations we benchmark.
 *
 * - Polynomial basis: GF(2)[x] / (x^128 + x^7 + x^2 + x + 1), bit i is the coefficient of x^i.
 *   This is the GHASH field, up to bit order, as used by Longfellow, Flock and Ligerito.
 * - Fan–Paar binary tower: level k has 2^k bits and generator X_k with
 *   X_k^2 = X_k X_{k-1} + 1, X_0 = 1, elements split as hi X_k + lo. Same coordinates as
 *   CompPoly's `ConcreteBinaryTower` and Binius's tower fields.
 */
export { clmul, mulPoly, mulTower, mulByGenerator, randomElement };

const MASK128 = (1n << 128n) - 1n;

function clmul(a: bigint, b: bigint) {
  let r = 0n;
  for (; b !== 0n; b >>= 1n, a <<= 1n) if (b & 1n) r ^= a;
  return r;
}

function mulPoly(a: bigint, b: bigint) {
  let z = clmul(a, b);
  while (z >> 128n) {
    let hi = z >> 128n;
    z = (z & MASK128) ^ hi ^ (hi << 1n) ^ (hi << 2n) ^ (hi << 7n);
  }
  return z;
}

function mulTower(a: bigint, b: bigint, level = 7): bigint {
  if (level === 0) return a & b;
  let half = 1n << BigInt(level - 1);
  let mask = (1n << half) - 1n;
  let [a0, a1, b0, b1] = [a & mask, a >> half, b & mask, b >> half];
  let p0 = mulTower(a0, b0, level - 1);
  let p2 = mulTower(a1, b1, level - 1);
  let p1 = mulTower(a0 ^ a1, b0 ^ b1, level - 1);
  let lo = p0 ^ p2;
  return ((p1 ^ lo ^ mulByGenerator(p2, level - 1)) << half) | lo;
}

// v X_k for v at level k
function mulByGenerator(v: bigint, level: number): bigint {
  if (level === 0) return v;
  let half = 1n << BigInt(level - 1);
  let mask = (1n << half) - 1n;
  let [v0, v1] = [v & mask, v >> half];
  return ((v0 ^ mulByGenerator(v1, level - 1)) << half) | v1;
}

function randomElement() {
  let bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytes.reduce(
    (acc, byte, i) => acc | (BigInt(byte) << BigInt(8 * i)),
    0n,
  );
}
