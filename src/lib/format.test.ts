/**
 * format.test.ts
 *
 * Tests for idle-game big-number formatting.
 * Covers: zero, sub-K, exact thresholds, K/M/B/T, named tiers, scientific,
 * rates, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { D } from './bignum';
import { formatBig, formatRate } from './format';

// ---------------------------------------------------------------------------
// Zero
// ---------------------------------------------------------------------------

describe('formatBig — zero', () => {
  it('formats 0 as "0"', () => {
    expect(formatBig(D(0))).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Sub-K — plain numbers shown with up to 2 decimal places
// ---------------------------------------------------------------------------

describe('formatBig — sub-K range (< 1,000)', () => {
  it('formats small integers without decimals', () => {
    expect(formatBig(D(1))).toBe('1');
    expect(formatBig(D(42))).toBe('42');
    expect(formatBig(D(999))).toBe('999');
  });

  it('formats a decimal value to at most 2 decimal places', () => {
    expect(formatBig(D('1.5'))).toBe('1.50');
    expect(formatBig(D('3.14159'))).toBe('3.14');
  });

  it('formats values below 1 with decimals', () => {
    expect(formatBig(D('0.5'))).toBe('0.50');
    expect(formatBig(D('0.001'))).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// Exact boundary — 1,000 should be "1.00K"
// ---------------------------------------------------------------------------

describe('formatBig — exact 1K boundary', () => {
  it('formats exactly 1000 as "1.00K"', () => {
    expect(formatBig(D(1000))).toBe('1.00K');
  });

  it('formats 999 as plain "999" (just below threshold)', () => {
    expect(formatBig(D(999))).toBe('999');
  });

  it('formats 1001 as "1.00K"', () => {
    expect(formatBig(D(1001))).toBe('1.00K');
  });
});

// ---------------------------------------------------------------------------
// K range (1,000 – 999,999)
// ---------------------------------------------------------------------------

describe('formatBig — K range', () => {
  it('formats 1500 as "1.50K"', () => {
    expect(formatBig(D(1500))).toBe('1.50K');
  });

  it('formats 10000 as "10.00K"', () => {
    expect(formatBig(D(10000))).toBe('10.00K');
  });

  it('formats 999999 as "1000.00K" or rolls over to M', () => {
    // 999999 / 1000 = 999.999 → "1000.00K" rounds up to M at exactly 1e6
    // Our implementation should show "999.99K" (truncate/floor, not round up to M)
    // This pinpoints the exact boundary behaviour.
    const result = formatBig(D(999999));
    expect(result).toMatch(/^999\.\d+K$/);
  });
});

// ---------------------------------------------------------------------------
// M range (1,000,000 – 999,999,999)
// ---------------------------------------------------------------------------

describe('formatBig — M range', () => {
  it('formats exactly 1e6 as "1.00M"', () => {
    expect(formatBig(D(1e6))).toBe('1.00M');
  });

  it('formats 2.5e6 as "2.50M"', () => {
    expect(formatBig(D(2.5e6))).toBe('2.50M');
  });

  it('formats 500e6 as "500.00M"', () => {
    expect(formatBig(D(500e6))).toBe('500.00M');
  });
});

// ---------------------------------------------------------------------------
// B range (1e9 – 999e9)
// ---------------------------------------------------------------------------

describe('formatBig — B range', () => {
  it('formats exactly 1e9 as "1.00B"', () => {
    expect(formatBig(D(1e9))).toBe('1.00B');
  });

  it('formats 42.5e9 as "42.50B"', () => {
    expect(formatBig(D(42.5e9))).toBe('42.50B');
  });
});

// ---------------------------------------------------------------------------
// T range (1e12 – 999e12)
// ---------------------------------------------------------------------------

describe('formatBig — T range', () => {
  it('formats exactly 1e12 as "1.00T"', () => {
    expect(formatBig(D(1e12))).toBe('1.00T');
  });

  it('formats 1.23e12 as "1.23T"', () => {
    expect(formatBig(D(1.23e12))).toBe('1.23T');
  });
});

// ---------------------------------------------------------------------------
// Named tiers past T (1e15+)
// ---------------------------------------------------------------------------

describe('formatBig — named tiers (1e15+)', () => {
  it('formats 1e15 with a named tier or scientific', () => {
    const result = formatBig(D('1e15'));
    // Should NOT be plain scientific like 1e+15; must be human-readable
    // Accept either "1.00Qa" (quadrillion) or similar named tier
    expect(result).not.toBe('1e+15');
    expect(result.length).toBeGreaterThan(2);
  });

  it('formats 1e18 with a named tier or scientific notation', () => {
    const result = formatBig(D('1e18'));
    expect(result).not.toBe('1e+18');
  });

  it('formats 1e30 as the No (nonillion) tier', () => {
    expect(formatBig(D('1e30'))).toBe('1.00No');
  });

  it('formats 1e33 as the Dc (decillion) tier', () => {
    expect(formatBig(D('1e33'))).toBe('1.00Dc');
  });

  it('formats the top of the Dc range without rolling past it', () => {
    // 1e35 = 100.00Dc — still inside named tiers, must not overflow to scientific
    expect(formatBig(D('1e35'))).toBe('100.00Dc');
  });
});

// ---------------------------------------------------------------------------
// Scientific fallback
// ---------------------------------------------------------------------------

describe('formatBig — scientific fallback for very large values', () => {
  it('switches to scientific exactly at 1e36 (past the last named tier)', () => {
    expect(formatBig(D('1e36'))).toBe('1.00e+36');
  });

  it('produces scientific notation for 1e100 (never "InfinityDc")', () => {
    const result = formatBig(D('1e100'));
    expect(result).toBe('1.00e+100');
    expect(result).not.toMatch(/Infinity/);
    expect(result).not.toMatch(/Dc/);
  });

  it('handles values beyond JS float range (1e400) without overflowing', () => {
    // toNumber() would be Infinity here; the guard must route to scientific first
    const result = formatBig(D('1e400'));
    expect(result).toBe('1.00e+400');
    expect(result).not.toMatch(/Infinity/);
  });
});

// ---------------------------------------------------------------------------
// Options — decimal places override
// ---------------------------------------------------------------------------

describe('formatBig — opts.decimals override', () => {
  it('shows 0 decimal places when decimals:0 (floors, not rounds)', () => {
    // 1500 / 1000 = 1.5 → floored to 1 → "1K"
    expect(formatBig(D(1500), { decimals: 0 })).toBe('1K');
  });

  it('shows 3 decimal places when decimals:3', () => {
    expect(formatBig(D(1500), { decimals: 3 })).toBe('1.500K');
  });
});

// ---------------------------------------------------------------------------
// formatRate
// ---------------------------------------------------------------------------

describe('formatRate', () => {
  it('appends "/s" to the formatted value', () => {
    expect(formatRate(D(1000))).toBe('1.00K/s');
  });

  it('works for sub-K rates', () => {
    expect(formatRate(D(42))).toBe('42/s');
  });

  it('works for large rates', () => {
    const result = formatRate(D('1e9'));
    expect(result).toMatch(/\/s$/);
  });

  it('zero rate formats as "0/s"', () => {
    expect(formatRate(D(0))).toBe('0/s');
  });

  it('passes options through', () => {
    // 1500 / 1000 = 1.5 → floored to 1 → "1K/s"
    expect(formatRate(D(1500), { decimals: 0 })).toBe('1K/s');
  });
});
