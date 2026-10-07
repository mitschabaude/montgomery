export { wideParams };

/**
 * Limbs and value range of the wide backend: n 64-bit limbs, Montgomery radix
 * R = 2^(64n), and values in [0, limit), where limit = 2p if that fits in R
 * ("lazy" reduction), and p otherwise.
 */
function wideParams(p: bigint) {
  const n = Math.ceil(p.toString(2).length / 64);
  const R = 1n << BigInt(64 * n);
  const lazy = 2n * p < R;
  const limit = lazy ? 2n * p : p;
  return { n, size: 8 * n, R, lazy, limit };
}
