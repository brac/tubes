/**
 * format.ts
 *
 * Idle-game big-number formatting.
 *
 * Tiers:
 *   < 1,000         — plain decimal (up to 2 decimal places)
 *   1K – 999K       — K
 *   1M – 999M       — M
 *   1B – 999B       — B
 *   1T – 999T       — T
 *   1Qa – 999Qa     — Qa  (quadrillion,  1e15)
 *   1Qi – 999Qi     — Qi  (quintillion,  1e18)
 *   1Sx – 999Sx     — Sx  (sextillion,   1e21)
 *   1Sp – 999Sp     — Sp  (septillion,   1e24)
 *   1Oc – 999Oc     — Oc  (octillion,    1e27)
 *   1No – 999No     — No  (nonillion,    1e30)
 *   1Dc – 999Dc     — Dc  (decillion,    1e33)
 *   beyond          — scientific (e.g. 1.23e+45)
 *
 * All pure/deterministic — no RNG, no wall-clock reads.
 */

import { cmp, ZERO } from './bignum';
import type { Decimal } from './bignum';

// ---------------------------------------------------------------------------
// Tier table  (ordered from largest to smallest for easy lookup)
// ---------------------------------------------------------------------------

const TIERS: ReadonlyArray<{ suffix: string; threshold: number }> = [
  { suffix: 'Dc', threshold: 33 },  // 1e33 decillion
  { suffix: 'No', threshold: 30 },  // 1e30 nonillion
  { suffix: 'Oc', threshold: 27 },  // 1e27 octillion
  { suffix: 'Sp', threshold: 24 },  // 1e24 septillion
  { suffix: 'Sx', threshold: 21 },  // 1e21 sextillion
  { suffix: 'Qi', threshold: 18 },  // 1e18 quintillion
  { suffix: 'Qa', threshold: 15 },  // 1e15 quadrillion
  { suffix: 'T',  threshold: 12 },  // 1e12 trillion
  { suffix: 'B',  threshold: 9  },  // 1e9  billion
  { suffix: 'M',  threshold: 6  },  // 1e6  million
  { suffix: 'K',  threshold: 3  },  // 1e3  thousand
];

// Exponent at/above which we abandon named tiers for scientific notation.
// The largest tier is Dc (1e33); it reads up to "999.99Dc" (≈ 1e36). Beyond
// that there is no named tier, and `Decimal.toNumber()` overflows to Infinity
// above ~1e308 — so route everything from 1e36 up through `toScientific`.
const SCIENTIFIC_THRESHOLD_EXP = 36;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FormatOpts {
  /**
   * Number of decimal places to show in the suffixed value.
   * Defaults to 2.
   */
  decimals?: number;
}

/**
 * formatBig — converts a Decimal to a human-readable idle-game string.
 *
 * Examples:
 *   0        → "0"
 *   42       → "42"
 *   1000     → "1.00K"
 *   1500     → "1.50K"
 *   1e9      → "1.00B"
 *   1e15     → "1.00Qa"
 *   1e100    → scientific fallback
 */
export function formatBig(value: Decimal, opts?: FormatOpts): string {
  const decimals = opts?.decimals ?? 2;

  // Fast-path: zero (via the bignum wrapper, not break_infinity internals)
  if (cmp(value, ZERO) === 0) {
    return '0';
  }

  const exp = value.e;

  // Beyond the named tiers (and past JS float range): scientific notation.
  // Guard BEFORE the tier loop so `toNumber()` never overflows to Infinity.
  if (exp >= SCIENTIFIC_THRESHOLD_EXP) {
    return toScientific(value, decimals);
  }

  // Sub-K: use plain formatting
  if (exp < 3) {
    const n = value.toNumber();
    if (n === 0) return '0';
    // Show decimals only when the value is not a whole number
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(decimals);
  }

  // Named tier lookup — floor the scaled value so 999,999 stays "999.99K"
  // rather than rounding up to "1000.00K".
  for (const tier of TIERS) {
    if (exp >= tier.threshold) {
      const divisor = Math.pow(10, tier.threshold);
      const raw = value.toNumber() / divisor;
      // Floor to the requested decimal precision to avoid crossing the boundary
      const factor = Math.pow(10, decimals);
      const scaled = Math.floor(raw * factor) / factor;
      return `${scaled.toFixed(decimals)}${tier.suffix}`;
    }
  }

  // Safety net for any exponent gap between tiers (unreachable with the current
  // contiguous TIERS table, but keeps the function total).
  return toScientific(value, decimals);
}

/**
 * formatRate — wraps formatBig with a "/s" suffix for per-second rates.
 *
 * Examples:
 *   D(1000) → "1.00K/s"
 *   D(0)    → "0/s"
 */
export function formatRate(value: Decimal, opts?: FormatOpts): string {
  return `${formatBig(value, opts)}/s`;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Produce scientific notation for values beyond the named tier table.
 * Uses break_infinity's mantissa/exponent directly for accuracy.
 * Format: "1.23e+45"
 */
function toScientific(value: Decimal, decimals: number): string {
  const m = value.m.toFixed(decimals);
  const e = value.e;
  const sign = e >= 0 ? '+' : '-';
  return `${m}e${sign}${Math.abs(e)}`;
}
