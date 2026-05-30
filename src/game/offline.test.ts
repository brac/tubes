/**
 * offline.test.ts
 *
 * Tests for computeOfflineEarnings and applyOfflineEarnings.
 * Written FIRST (TDD/RED) before implementation exists.
 *
 * Coverage goals:
 *   - zero elapsed → zero gain
 *   - gain scales linearly with elapsed under the cap
 *   - elapsed above cap is clamped (cap and 2*cap give equal gain)
 *   - negative elapsed → zero gain
 *   - gain uses the rate at save time (upgraded state earns more than bare)
 *   - Protocol offline multiplier increases gain
 *   - applyOfflineEarnings adds to revenue immutably (input unchanged)
 */

import { describe, it, expect } from 'vitest';
import { D, ZERO } from '../lib/bignum';
import type { Decimal } from '../lib/bignum';
import { initialState } from './state';
import { revenueRate } from './economy';
import { offlineMultiplier } from './protocol';
import { computeOfflineEarnings, applyOfflineEarnings } from './offline';
import {
  OFFLINE_CAP_MS,
  OFFLINE_EFFICIENCY,
  AUTOSAVE_INTERVAL_MS,
} from './config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tolerance: two Decimals are close enough if their ratio is within 1e-9. */
function nearlyEqual(a: Decimal, b: Decimal, tol = 1e-9): boolean {
  const bNum = b.toNumber();
  const aNum = a.toNumber();
  if (bNum === 0 && aNum === 0) return true;
  if (bNum === 0) return Math.abs(aNum) < tol;
  return Math.abs((aNum - bNum) / bNum) < tol;
}

/** Build a state with a specific upgrade level (cleaner-lines for bandwidth). */
function stateWithUpgrades(levels: Record<string, number>, now = 0) {
  return { ...initialState(now), upgradeLevels: levels };
}

/** Build a state with a specific protocol level for offline-boost. */
function stateWithOfflineBoost(level: number, now = 0) {
  return {
    ...initialState(now),
    protocolLevels: { 'offline-boost': level },
  };
}

// ---------------------------------------------------------------------------
// computeOfflineEarnings
// ---------------------------------------------------------------------------

describe('computeOfflineEarnings', () => {
  it('returns zero gained and zero cappedMs when elapsedMs is 0', () => {
    const state = initialState(0);
    const { gained, cappedMs } = computeOfflineEarnings(state, 0);
    expect(gained.toNumber()).toBe(0);
    expect(cappedMs).toBe(0);
  });

  it('returns zero gained when elapsedMs is negative (clock skew)', () => {
    const state = initialState(0);
    const { gained, cappedMs } = computeOfflineEarnings(state, -5000);
    expect(gained.toNumber()).toBe(0);
    expect(cappedMs).toBe(0);
  });

  it('scales linearly with elapsed for values under the cap', () => {
    const state = initialState(0);
    const rate = revenueRate(state).toNumber();
    const offline = offlineMultiplier(state).toNumber();

    const { gained: gained1, cappedMs: capped1 } = computeOfflineEarnings(state, 1000);
    const { gained: gained2, cappedMs: capped2 } = computeOfflineEarnings(state, 2000);

    expect(capped1).toBe(1000);
    expect(capped2).toBe(2000);

    // gained ≈ rate * (cappedMs/1000) * OFFLINE_EFFICIENCY * offlineMultiplier
    const expected1 = rate * (1000 / 1000) * OFFLINE_EFFICIENCY * offline;
    const expected2 = rate * (2000 / 1000) * OFFLINE_EFFICIENCY * offline;

    expect(nearlyEqual(gained1, D(expected1))).toBe(true);
    expect(nearlyEqual(gained2, D(expected2))).toBe(true);

    // Ratio should be exactly 2 (linear)
    expect(nearlyEqual(gained2, D(gained1.toNumber() * 2))).toBe(true);
  });

  it('clamps elapsed to OFFLINE_CAP_MS when elapsed equals the cap', () => {
    const state = initialState(0);
    const { cappedMs } = computeOfflineEarnings(state, OFFLINE_CAP_MS);
    expect(cappedMs).toBe(OFFLINE_CAP_MS);
  });

  it('clamps elapsed to OFFLINE_CAP_MS when elapsed is double the cap', () => {
    const state = initialState(0);
    const { gained: gainedAtCap, cappedMs: cappedAtCap } = computeOfflineEarnings(
      state,
      OFFLINE_CAP_MS,
    );
    const { gained: gainedAt2Cap, cappedMs: cappedAt2Cap } = computeOfflineEarnings(
      state,
      OFFLINE_CAP_MS * 2,
    );

    // Both should report the same cappedMs and the same gained
    expect(cappedAtCap).toBe(OFFLINE_CAP_MS);
    expect(cappedAt2Cap).toBe(OFFLINE_CAP_MS);
    expect(nearlyEqual(gainedAtCap, gainedAt2Cap)).toBe(true);
  });

  it('an upgraded state earns more than a bare state over the same elapsed time', () => {
    // Use a state where demand far exceeds starting bandwidth so that adding
    // bandwidth via upgrades actually shifts the bottleneck (revenueRate goes up).
    // initialState has bandwidth=60, demand=50 → demand is already the floor,
    // so we craft a state with very high demand to force a deficit scenario.
    const highDemand = { ...initialState(0), demand: D(1_000) };
    const bare = highDemand;
    // 100 levels of 'cleaner-lines' × 5 bps = +500 bps → total bandwidth 560
    const upgraded = { ...highDemand, upgradeLevels: { 'cleaner-lines': 100 } };

    const { gained: gainedBare } = computeOfflineEarnings(bare, 10_000);
    const { gained: gainedUpgraded } = computeOfflineEarnings(upgraded, 10_000);

    // upgraded bandwidth (560 bps) > bare bandwidth (60 bps); both < demand (1000)
    // so upgraded dataCarried is higher → higher gain
    expect(gainedUpgraded.toNumber()).toBeGreaterThan(gainedBare.toNumber());
  });

  it('Protocol offline-boost multiplier increases gain proportionally', () => {
    const base = initialState(0);
    // offline-boost level 1 → offlineMultiplier = 1 + 0.20 * 1 = 1.20
    const boosted = stateWithOfflineBoost(1);

    const { gained: gainedBase } = computeOfflineEarnings(base, 5_000);
    const { gained: gainedBoosted } = computeOfflineEarnings(boosted, 5_000);

    const ratio = gainedBoosted.toNumber() / gainedBase.toNumber();
    // Expected ratio = 1.20 / 1.00 = 1.2
    expect(Math.abs(ratio - 1.2)).toBeLessThan(1e-9);
  });

  it('returns numeric cappedMs matching the actual elapsed when under cap', () => {
    const state = initialState(0);
    const elapsed = 30_000;
    const { cappedMs } = computeOfflineEarnings(state, elapsed);
    expect(cappedMs).toBe(elapsed);
  });

  it('exports OFFLINE_CAP_MS, OFFLINE_EFFICIENCY, AUTOSAVE_INTERVAL_MS from config', () => {
    // Sanity-check that tuning constants are reachable and in valid ranges
    expect(OFFLINE_CAP_MS).toBeGreaterThan(0);
    expect(OFFLINE_EFFICIENCY).toBeGreaterThan(0);
    expect(OFFLINE_EFFICIENCY).toBeLessThanOrEqual(1);
    expect(AUTOSAVE_INTERVAL_MS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// applyOfflineEarnings
// ---------------------------------------------------------------------------

describe('applyOfflineEarnings', () => {
  it('returns a new state with revenue increased by gained', () => {
    const state = initialState(0);
    const elapsed = 60_000; // 1 minute

    const { state: next, gained, cappedMs } = applyOfflineEarnings(state, elapsed);

    // Revenue should have increased
    expect(next.revenue.toNumber()).toBeGreaterThan(state.revenue.toNumber());

    // The delta should equal gained
    const delta = next.revenue.toNumber() - state.revenue.toNumber();
    expect(nearlyEqual(D(delta), gained)).toBe(true);

    // cappedMs is available in the result
    expect(cappedMs).toBe(elapsed);
  });

  it('does NOT mutate the input state', () => {
    const state = initialState(0);
    const originalRevenue = state.revenue.toNumber();

    applyOfflineEarnings(state, 60_000);

    // Original state revenue must be unchanged
    expect(state.revenue.toNumber()).toBe(originalRevenue);
  });

  it('returns a different object reference from the input (immutability)', () => {
    const state = initialState(0);
    const { state: next } = applyOfflineEarnings(state, 60_000);
    expect(next).not.toBe(state);
  });

  it('returns unchanged revenue when elapsed is 0', () => {
    const state = initialState(0);
    const { state: next, gained } = applyOfflineEarnings(state, 0);
    expect(gained.toNumber()).toBe(0);
    expect(next.revenue.toNumber()).toBe(state.revenue.toNumber());
  });

  it('preserves all non-revenue fields on the returned state', () => {
    const state = stateWithUpgrades({ 'cleaner-lines': 2 }, 12345);
    const { state: next } = applyOfflineEarnings(state, 5_000);

    // Everything except revenue should be identical
    expect(next.era).toBe(state.era);
    expect(next.upgradeLevels).toEqual(state.upgradeLevels);
    expect(next.demand.toNumber()).toBe(state.demand.toNumber());
    expect(next.congestionEfficiency).toBe(state.congestionEfficiency);
    expect(next.deficitMs).toBe(state.deficitMs);
    expect(next.elapsedMs).toBe(state.elapsedMs);
    expect(next.lastSaveAt).toBe(state.lastSaveAt);
    expect(next.protocol.toNumber()).toBe(state.protocol.toNumber());
    expect(next.protocolLevels).toEqual(state.protocolLevels);
    expect(next.runPeakRevenueRate.toNumber()).toBe(state.runPeakRevenueRate.toNumber());
    expect(next.eraGateMs).toBe(state.eraGateMs);
  });
});
