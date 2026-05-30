/**
 * bignum.test.ts
 *
 * Tests for the bignum wrapper. Covers construction, arithmetic, comparisons,
 * and very large values (>1e15) where naive JS floats silently lose precision.
 */

import { describe, it, expect } from 'vitest';
import {
  D,
  add,
  sub,
  mul,
  div,
  pow,
  min,
  max,
  cmp,
  gte,
  gt,
  lte,
  lt,
  ZERO,
  ONE,
} from './bignum';

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('D() constructor', () => {
  it('constructs from a plain integer', () => {
    expect(D(42).toString()).toBe('42');
  });

  it('constructs from a float', () => {
    expect(D(3.14).toNumber()).toBeCloseTo(3.14);
  });

  it('constructs from a string', () => {
    expect(D('100').toString()).toBe('100');
  });

  it('constructs from another Decimal (pass-through)', () => {
    const a = D(7);
    expect(D(a).toString()).toBe('7');
  });

  it('constructs zero from 0', () => {
    expect(D(0).toString()).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('ZERO and ONE constants', () => {
  it('ZERO equals 0', () => {
    expect(ZERO.toString()).toBe('0');
  });

  it('ONE equals 1', () => {
    expect(ONE.toString()).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// Basic arithmetic — small numbers (sanity)
// ---------------------------------------------------------------------------

describe('add', () => {
  it('adds two small numbers', () => {
    expect(add(D(3), D(4)).toString()).toBe('7');
  });

  it('adding zero returns original value', () => {
    expect(add(D(99), ZERO).toString()).toBe('99');
  });
});

describe('sub', () => {
  it('subtracts two small numbers', () => {
    expect(sub(D(10), D(3)).toString()).toBe('7');
  });

  it('subtracts to produce zero', () => {
    expect(sub(D(5), D(5)).toString()).toBe('0');
  });
});

describe('mul', () => {
  it('multiplies two small numbers', () => {
    expect(mul(D(6), D(7)).toString()).toBe('42');
  });

  it('multiplying by ONE is identity', () => {
    expect(mul(D(123), ONE).toString()).toBe('123');
  });

  it('multiplying by ZERO is zero', () => {
    expect(mul(D(999), ZERO).toString()).toBe('0');
  });
});

describe('div', () => {
  it('divides evenly', () => {
    expect(div(D(42), D(6)).toString()).toBe('7');
  });

  it('produces a decimal result', () => {
    expect(div(D(1), D(4)).toNumber()).toBeCloseTo(0.25);
  });
});

describe('pow', () => {
  it('raises to an integer exponent', () => {
    expect(pow(D(2), D(10)).toString()).toBe('1024');
  });

  it('anything to the power 0 is 1', () => {
    expect(pow(D(999), ZERO).toString()).toBe('1');
  });

  it('anything to the power 1 is itself', () => {
    expect(pow(D(42), ONE).toString()).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// Large-number precision — the whole reason we use break_infinity
// ---------------------------------------------------------------------------

describe('large number precision (>1e15)', () => {
  it('handles 1e30 without becoming Infinity', () => {
    const big = D('1e30');
    // break_infinity stores value as mantissa * 10^exponent.
    // A finite value will have a finite exponent; Infinity would have e === Infinity.
    expect(isFinite(big.e)).toBe(true);
    expect(big.e).toBe(30);
  });

  it('adds two 1e30 values correctly', () => {
    const a = D('1e30');
    const b = D('1e30');
    const result = add(a, b);
    // 2e30 — exponent should be 30, mantissa 2
    expect(result.toString()).toBe('2e+30');
  });

  it('multiplies large numbers without overflow', () => {
    const a = D('1e200');
    const b = D('1e200');
    const result = mul(a, b);
    expect(result.toString()).toBe('1e+400');
  });

  it('naive JS float loses precision at 1e16 (demonstrates why big-num is needed)', () => {
    // Native JS number loses integer precision above Number.MAX_SAFE_INTEGER (~9e15)
    const naive = 1e16 + 1; // This may round to 1e16
    expect(naive).toBe(1e16); // loss of precision — this is the problem we solve
  });

  it('break_infinity handles values well beyond JS float precision range', () => {
    const a = D('1e300');
    const b = D('1e299');
    // Both must be finite (not overflow to Infinity) and must compare correctly
    expect(isFinite(a.e)).toBe(true);
    expect(isFinite(b.e)).toBe(true);
    // 1e300 > 1e299
    expect(cmp(a, b)).toBe(1);
  });

  it('pow handles e300+ exponents', () => {
    const result = pow(D(10), D(300));
    expect(result.toString()).toBe('1e+300');
  });
});

// ---------------------------------------------------------------------------
// min / max
// ---------------------------------------------------------------------------

describe('min', () => {
  it('returns the smaller value', () => {
    expect(min(D(3), D(7)).toString()).toBe('3');
  });

  it('returns first when equal', () => {
    expect(min(D(5), D(5)).toString()).toBe('5');
  });

  it('works with large numbers', () => {
    expect(min(D('1e50'), D('2e50')).toString()).toBe('1e+50');
  });
});

describe('max', () => {
  it('returns the larger value', () => {
    expect(max(D(3), D(7)).toString()).toBe('7');
  });

  it('works with large numbers', () => {
    expect(max(D('1e50'), D('2e50')).toString()).toBe('2e+50');
  });
});

// ---------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------

describe('cmp', () => {
  it('returns -1 when a < b', () => {
    expect(cmp(D(1), D(2))).toBe(-1);
  });

  it('returns 0 when a === b', () => {
    expect(cmp(D(5), D(5))).toBe(0);
  });

  it('returns 1 when a > b', () => {
    expect(cmp(D(10), D(3))).toBe(1);
  });

  it('compares large numbers correctly', () => {
    expect(cmp(D('1e100'), D('9e99'))).toBe(1);
  });
});

describe('gte / gt / lte / lt', () => {
  it('gte returns true when equal', () => {
    expect(gte(D(5), D(5))).toBe(true);
  });

  it('gte returns true when greater', () => {
    expect(gte(D(6), D(5))).toBe(true);
  });

  it('gte returns false when less', () => {
    expect(gte(D(4), D(5))).toBe(false);
  });

  it('gt returns false when equal', () => {
    expect(gt(D(5), D(5))).toBe(false);
  });

  it('gt returns true when strictly greater', () => {
    expect(gt(D(6), D(5))).toBe(true);
  });

  it('lte returns true when equal', () => {
    expect(lte(D(5), D(5))).toBe(true);
  });

  it('lte returns true when less', () => {
    expect(lte(D(4), D(5))).toBe(true);
  });

  it('lt returns false when equal', () => {
    expect(lt(D(5), D(5))).toBe(false);
  });

  it('lt returns true when strictly less', () => {
    expect(lt(D(4), D(5))).toBe(true);
  });
});
