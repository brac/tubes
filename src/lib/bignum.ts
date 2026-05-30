/**
 * bignum.ts
 *
 * Thin typed wrapper over break_infinity.js Decimal.
 *
 * This is the ONLY module in the codebase that imports from 'break_infinity.js'.
 * All other modules must go through these helpers.
 *
 * Why break_infinity? Native JS floats silently lose integer precision above
 * Number.MAX_SAFE_INTEGER (~9e15). An idle game quickly exceeds that. This
 * library stores values as mantissa × 10^exponent and handles up to ~1e(1e308).
 */

import Decimal from 'break_infinity.js';

// Re-export the Decimal type so callers can type their variables without
// importing break_infinity directly.
export type { Decimal };

// ---------------------------------------------------------------------------
// Construction helper
// ---------------------------------------------------------------------------

/**
 * D(x) — construct a Decimal from a number, string, or existing Decimal.
 * Use this instead of `new Decimal(x)` everywhere outside this file.
 */
export function D(x: number | string | Decimal): Decimal {
  if (x instanceof Decimal) return x;
  return new Decimal(x);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ZERO: Decimal = new Decimal(0);
export const ONE: Decimal = new Decimal(1);

// ---------------------------------------------------------------------------
// Arithmetic — all return NEW Decimal instances (immutability contract)
// ---------------------------------------------------------------------------

/** a + b */
export function add(a: Decimal, b: Decimal): Decimal {
  return a.add(b);
}

/** a - b */
export function sub(a: Decimal, b: Decimal): Decimal {
  return a.sub(b);
}

/** a * b */
export function mul(a: Decimal, b: Decimal): Decimal {
  return a.mul(b);
}

/** a / b */
export function div(a: Decimal, b: Decimal): Decimal {
  return a.div(b);
}

/**
 * a ^ b (exponentiation).
 * break_infinity's pow accepts a Decimal exponent.
 */
export function pow(a: Decimal, b: Decimal): Decimal {
  return Decimal.pow(a, b.toNumber());
}

// ---------------------------------------------------------------------------
// min / max
// ---------------------------------------------------------------------------

/** Returns the smaller of a and b. */
export function min(a: Decimal, b: Decimal): Decimal {
  return Decimal.min(a, b);
}

/** Returns the larger of a and b. */
export function max(a: Decimal, b: Decimal): Decimal {
  return Decimal.max(a, b);
}

// ---------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------

/**
 * cmp(a, b) — strict three-way comparison.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function cmp(a: Decimal, b: Decimal): -1 | 0 | 1 {
  return Decimal.cmp(a, b);
}

/** a >= b */
export function gte(a: Decimal, b: Decimal): boolean {
  return Decimal.gte(a, b);
}

/** a > b */
export function gt(a: Decimal, b: Decimal): boolean {
  return Decimal.gt(a, b);
}

/** a <= b */
export function lte(a: Decimal, b: Decimal): boolean {
  return Decimal.lte(a, b);
}

/** a < b */
export function lt(a: Decimal, b: Decimal): boolean {
  return Decimal.lt(a, b);
}
