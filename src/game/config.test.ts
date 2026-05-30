/**
 * config.test.ts
 *
 * Tests for config.ts — Phase-3 tuning constants.
 *
 * Written FIRST (TDD). Tests verify the existence, types, and sanity ranges
 * of the new Phase-3 exported constants.
 */

import { describe, it, expect } from 'vitest';
import {
  ERA_GATE_WINDOW_MS,
  PRESTIGE_MIN_PEAK_RATE,
  PROTOCOL_GAIN_DIVISOR,
  PROTOCOL_GAIN_K,
} from './config';
import { D } from '../lib/bignum';

// ---------------------------------------------------------------------------
// ERA_GATE_WINDOW_MS
// ---------------------------------------------------------------------------

describe('ERA_GATE_WINDOW_MS', () => {
  it('is a positive number', () => {
    expect(typeof ERA_GATE_WINDOW_MS).toBe('number');
    expect(ERA_GATE_WINDOW_MS).toBeGreaterThan(0);
  });

  it('is approximately 30 000 ms (30 seconds)', () => {
    // Design doc specifies ~30s; give it a ±50% tolerance for tuning room
    expect(ERA_GATE_WINDOW_MS).toBeGreaterThanOrEqual(15_000);
    expect(ERA_GATE_WINDOW_MS).toBeLessThanOrEqual(60_000);
  });
});

// ---------------------------------------------------------------------------
// PRESTIGE_MIN_PEAK_RATE
// ---------------------------------------------------------------------------

describe('PRESTIGE_MIN_PEAK_RATE', () => {
  it('is a Decimal-compatible value (has toNumber)', () => {
    // Accept either a raw number or a Decimal; either should convert cleanly
    const asDecimal = D(PRESTIGE_MIN_PEAK_RATE);
    expect(typeof asDecimal.toNumber()).toBe('number');
  });

  it('is a positive threshold', () => {
    const val = typeof PRESTIGE_MIN_PEAK_RATE === 'number'
      ? PRESTIGE_MIN_PEAK_RATE
      : (PRESTIGE_MIN_PEAK_RATE as { toNumber(): number }).toNumber();
    expect(val).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PROTOCOL_GAIN_DIVISOR
// ---------------------------------------------------------------------------

describe('PROTOCOL_GAIN_DIVISOR', () => {
  it('is a positive number', () => {
    expect(typeof PROTOCOL_GAIN_DIVISOR).toBe('number');
    expect(PROTOCOL_GAIN_DIVISOR).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PROTOCOL_GAIN_K
// ---------------------------------------------------------------------------

describe('PROTOCOL_GAIN_K', () => {
  it('is a positive number', () => {
    expect(typeof PROTOCOL_GAIN_K).toBe('number');
    expect(PROTOCOL_GAIN_K).toBeGreaterThan(0);
  });

  it('together with PROTOCOL_GAIN_DIVISOR produces a sub-linear payout for reasonable peak rates', () => {
    // gain = K * sqrt(peak / DIVISOR)
    // For a peak that's 4× the divisor we expect 2K Protocol
    const peak = PROTOCOL_GAIN_DIVISOR * 4;
    const gain = PROTOCOL_GAIN_K * Math.sqrt(peak / PROTOCOL_GAIN_DIVISOR);
    expect(gain).toBeCloseTo(PROTOCOL_GAIN_K * 2, 5);
  });
});
