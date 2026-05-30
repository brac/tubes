/**
 * prestige.test.ts
 *
 * TDD-first tests for prestige.ts.
 *
 * Covers:
 * - canPrestige threshold guard
 * - protocolGain sub-linear payout formula
 * - prestige() full reset behaviour
 * - CRITICAL invariant: eras NEVER regress on prestige
 */

import { describe, it, expect } from 'vitest';
import { canPrestige, protocolGain, prestige } from './prestige';
import { initialState } from './state';
import { D, ZERO } from '../lib/bignum';
import {
  PRESTIGE_MIN_PEAK_RATE,
  PROTOCOL_GAIN_DIVISOR,
  PROTOCOL_GAIN_K,
} from './config';
import { getEra } from './eras';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a fresh state with runPeakRevenueRate overridden. */
function stateWithPeak(peak: number) {
  return { ...initialState(0), runPeakRevenueRate: D(peak) };
}

// ---------------------------------------------------------------------------
// canPrestige
// ---------------------------------------------------------------------------

describe('canPrestige', () => {
  it('returns false when runPeakRevenueRate is ZERO', () => {
    const state = initialState(0);
    expect(canPrestige(state)).toBe(false);
  });

  it('returns false when runPeakRevenueRate is below the minimum threshold', () => {
    const state = stateWithPeak(PRESTIGE_MIN_PEAK_RATE - 1);
    expect(canPrestige(state)).toBe(false);
  });

  it('returns false when runPeakRevenueRate equals threshold minus a fraction', () => {
    const state = stateWithPeak(PRESTIGE_MIN_PEAK_RATE - 0.001);
    expect(canPrestige(state)).toBe(false);
  });

  it('returns true when runPeakRevenueRate exactly equals the minimum threshold', () => {
    const state = stateWithPeak(PRESTIGE_MIN_PEAK_RATE);
    expect(canPrestige(state)).toBe(true);
  });

  it('returns true when runPeakRevenueRate exceeds the minimum threshold', () => {
    const state = stateWithPeak(PRESTIGE_MIN_PEAK_RATE * 10);
    expect(canPrestige(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// protocolGain
// ---------------------------------------------------------------------------

describe('protocolGain', () => {
  it('returns ZERO when below threshold', () => {
    const state = stateWithPeak(PRESTIGE_MIN_PEAK_RATE - 1);
    const gain = protocolGain(state);
    expect(gain.toNumber()).toBe(0);
  });

  it('returns ZERO when runPeakRevenueRate is ZERO', () => {
    const state = initialState(0);
    expect(protocolGain(state).toNumber()).toBe(0);
  });

  it('returns a whole number (floored to integer)', () => {
    // peak = PROTOCOL_GAIN_DIVISOR / 2 → sqrt(0.5) * K ≈ 0.707 → floored to 0
    // Use a peak large enough to produce at least 1
    const state = stateWithPeak(PROTOCOL_GAIN_DIVISOR);
    const gain = protocolGain(state);
    // K * sqrt(1) = 1 exactly
    expect(gain.toNumber()).toBe(PROTOCOL_GAIN_K * 1);
    // Verify it's an integer
    expect(Number.isInteger(gain.toNumber())).toBe(true);
  });

  it('applies the K * sqrt(peak / DIVISOR) formula', () => {
    const peak = PROTOCOL_GAIN_DIVISOR * 4; // sqrt(4) = 2
    const state = stateWithPeak(peak);
    const expected = Math.floor(PROTOCOL_GAIN_K * Math.sqrt(4));
    expect(protocolGain(state).toNumber()).toBe(expected);
  });

  it('is sub-linear: 4x peak gives less than 4x protocol compared to 1x peak', () => {
    const basePeak = PROTOCOL_GAIN_DIVISOR; // gain = K * 1
    const quadPeak = PROTOCOL_GAIN_DIVISOR * 16; // gain = K * 4

    const gainBase = protocolGain(stateWithPeak(basePeak)).toNumber();
    const gainQuad = protocolGain(stateWithPeak(quadPeak)).toNumber();

    // sqrt sub-linearity: gainQuad/gainBase = 4, but gainBase * 16 would be linear
    // The ratio should be exactly 4 (sqrt(16)/sqrt(1)), which is less than 16
    expect(gainQuad).toBeLessThan(gainBase * 16);
  });

  it('floors the result — fractional sqrt output does not leak as a decimal', () => {
    // peak that produces a non-integer sqrt
    const peak = PROTOCOL_GAIN_DIVISOR * 2; // sqrt(2) ≈ 1.414
    const state = stateWithPeak(peak);
    const gain = protocolGain(state);
    const raw = PROTOCOL_GAIN_K * Math.sqrt(2); // ~1.414
    expect(gain.toNumber()).toBe(Math.floor(raw));
    expect(Number.isInteger(gain.toNumber())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// prestige() — full reducer
// ---------------------------------------------------------------------------

describe('prestige', () => {
  /** A state that satisfies canPrestige */
  function prestigeableState() {
    const base = initialState(0);
    return {
      ...base,
      // Set a peak above threshold
      runPeakRevenueRate: D(PROTOCOL_GAIN_DIVISOR), // gain = 1
      // Give the player some revenue
      revenue: D(99_999),
      // Several upgrade levels
      upgradeLevels: { 'cleaner-lines': 3, 'dedicated-line': 1 },
      // Congestion state
      congestionEfficiency: 0.8,
      deficitMs: 5_000,
      // Era gate progress
      eraGateMs: 15_000,
      // Existing protocol from a previous prestige
      protocol: D(3),
      protocolLevels: { 'revenue-boost': 2 },
      // Demand has drifted
      demand: D(999),
    };
  }

  it('is a no-op (returns the same reference) when canPrestige is false', () => {
    const state = initialState(0); // peak = ZERO → below threshold
    const result = prestige(state);
    expect(result).toBe(state); // same reference
  });

  it('resets revenue to ZERO', () => {
    const result = prestige(prestigeableState());
    expect(result.revenue.toNumber()).toBe(0);
  });

  it('resets upgradeLevels to an empty record', () => {
    const result = prestige(prestigeableState());
    expect(result.upgradeLevels).toEqual({});
  });

  it('resets congestionEfficiency to 1.0', () => {
    const result = prestige(prestigeableState());
    expect(result.congestionEfficiency).toBe(1.0);
  });

  it('resets deficitMs to 0', () => {
    const result = prestige(prestigeableState());
    expect(result.deficitMs).toBe(0);
  });

  it('resets eraGateMs to 0', () => {
    const result = prestige(prestigeableState());
    expect(result.eraGateMs).toBe(0);
  });

  it('resets runPeakRevenueRate to ZERO', () => {
    const result = prestige(prestigeableState());
    expect(result.runPeakRevenueRate.toNumber()).toBe(0);
  });

  it('resets demand to the current era baseDemand (not starting demand, not 0)', () => {
    const state = prestigeableState();
    const eraDef = getEra(state.era);
    const result = prestige(state);
    expect(result.demand.toNumber()).toBe(eraDef.baseDemand.toNumber());
  });

  it('adds protocolGain to existing protocol balance', () => {
    const state = prestigeableState();
    const expectedGain = protocolGain(state).toNumber(); // 1 at peak=DIVISOR
    const existingProtocol = state.protocol.toNumber(); // 3
    const result = prestige(state);
    expect(result.protocol.toNumber()).toBe(existingProtocol + expectedGain);
  });

  it('CRITICAL — preserves era (never regresses)', () => {
    const state = { ...prestigeableState(), era: 1 };
    const result = prestige(state);
    expect(result.era).toBe(1);
  });

  it('CRITICAL — era 2 is also preserved on prestige', () => {
    const state = { ...prestigeableState(), era: 2 };
    const result = prestige(state);
    expect(result.era).toBe(2);
  });

  it('CRITICAL — preserves protocolLevels (never lost on prestige)', () => {
    const state = prestigeableState();
    const result = prestige(state);
    expect(result.protocolLevels).toEqual({ 'revenue-boost': 2 });
  });

  it('returns a NEW object reference (immutable — does not mutate input)', () => {
    const state = prestigeableState();
    const result = prestige(state);
    expect(result).not.toBe(state);
    // Original state is unchanged
    expect(state.revenue.toNumber()).toBe(99_999);
  });

  it('preserves elapsedMs (simulation clock continues)', () => {
    const state = { ...prestigeableState(), elapsedMs: 42_000 };
    const result = prestige(state);
    expect(result.elapsedMs).toBe(42_000);
  });

  it('resets demand to era 2 baseDemand when player is in era 2', () => {
    const state = { ...prestigeableState(), era: 2 };
    const era2 = getEra(2);
    const result = prestige(state);
    expect(result.demand.toNumber()).toBe(era2.baseDemand.toNumber());
  });
});
