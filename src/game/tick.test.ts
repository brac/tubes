/**
 * tick.test.ts
 *
 * TDD-first tests for the tick simulation step and buyUpgrade utility.
 *
 * Tests cover:
 *   - step(): deterministic revenue accrual, demand growth, elapsed advance
 *   - step(): congestion updates flow through correctly
 *   - buyUpgrade(): spends revenue and increments level on affordable purchase
 *   - buyUpgrade(): no-op when unaffordable
 *   - buyUpgrade(): unknown upgrade id returns unchanged state
 *   - Immutability: input state never mutated by step() or buyUpgrade()
 */

import { describe, it, expect } from 'vitest';
import { D, gte } from '../lib/bignum';
import { initialState } from './state';
import { step, buyUpgrade } from './tick';
import { TICK_STEP_MS } from './config';
import { computeBandwidth, revenueRate } from './economy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A fresh state with a predictable timestamp. */
function freshState(revenue = 0) {
  const s = initialState(1000);
  if (revenue > 0) {
    return { ...s, revenue: D(revenue) };
  }
  return s;
}

// ---------------------------------------------------------------------------
// step() — basic field advancement
// ---------------------------------------------------------------------------

describe('step()', () => {
  it('returns a new object reference (immutability)', () => {
    const s = freshState();
    const next = step(s, TICK_STEP_MS);
    expect(next).not.toBe(s);
  });

  it('does not mutate the input state', () => {
    const s = freshState();
    const originalRevenue = s.revenue.toNumber();
    const originalElapsed = s.elapsedMs;
    step(s, TICK_STEP_MS);
    expect(s.revenue.toNumber()).toBe(originalRevenue);
    expect(s.elapsedMs).toBe(originalElapsed);
  });

  it('advances elapsedMs by dtMs', () => {
    const s = freshState();
    const next = step(s, TICK_STEP_MS);
    expect(next.elapsedMs).toBe(s.elapsedMs + TICK_STEP_MS);
  });

  it('advances elapsedMs by an arbitrary dtMs', () => {
    const s = freshState();
    const next = step(s, 250);
    expect(next.elapsedMs).toBe(250);
  });

  it('accrues revenue each tick based on revenueRate * dt', () => {
    const s = freshState();
    const dtSec = TICK_STEP_MS / 1000;

    const next = step(s, TICK_STEP_MS);
    const gained = next.revenue.toNumber();
    // Revenue should be positive and on the order of dataCarried * dtSec.
    // dataCarried = min(bw=60, demand~50) * 1.0 = ~50; * 0.1s = ~5
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeCloseTo(50 * dtSec, 1); // within ~0.1 of expected
  });

  it('accrues more revenue with high demand that uses full bandwidth (bought upgrades)', () => {
    // Set demand above starting bandwidth so upgraded state carries more data.
    const baseDemand = D(10_000);
    const plain = step({ ...freshState(), demand: baseDemand }, TICK_STEP_MS);
    const upgraded = step(
      { ...freshState(), demand: baseDemand, upgradeLevels: { 'cleaner-lines': 5 } },
      TICK_STEP_MS,
    );
    expect(upgraded.revenue.toNumber()).toBeGreaterThan(plain.revenue.toNumber());
  });

  it('demand increases after each step (continuous compounding)', () => {
    const s = freshState();
    const next = step(s, TICK_STEP_MS);
    expect(next.demand.toNumber()).toBeGreaterThan(s.demand.toNumber());
  });

  it('demand after two steps equals two sequential applications', () => {
    const s = freshState();
    const mid = step(s, TICK_STEP_MS);
    const double = step(mid, TICK_STEP_MS);

    // Compare to single step of 2×TICK_STEP_MS (continuous compounding equivalence)
    const singleBig = step(s, TICK_STEP_MS * 2);
    expect(double.demand.toNumber()).toBeCloseTo(singleBig.demand.toNumber(), 8);
  });

  it('preserves fields not owned by step (era, lastSaveAt, upgradeLevels)', () => {
    const s = { ...freshState(), era: 1, lastSaveAt: 9999, upgradeLevels: { 'isdn': 2 } };
    const next = step(s, TICK_STEP_MS);
    expect(next.era).toBe(1);
    expect(next.lastSaveAt).toBe(9999);
    expect(next.upgradeLevels).toEqual({ 'isdn': 2 });
  });

  it('congestionEfficiency stays at 1.0 when in surplus (no deficit)', () => {
    // Initial state has bandwidth > demand so congestion stays at 1.0.
    const s = freshState();
    const next = step(s, TICK_STEP_MS);
    expect(next.congestionEfficiency).toBe(1.0);
  });

  it('congestionEfficiency sags when demand exceeds bandwidth', () => {
    // Force demand far above bandwidth to trigger deficit congestion.
    const s = { ...freshState(), demand: D(10_000) };
    // Step many ticks to accumulate deficitMs
    let state = s;
    for (let i = 0; i < 100; i++) {
      state = step(state, TICK_STEP_MS);
    }
    expect(state.congestionEfficiency).toBeLessThan(1.0);
  });

  it('deficitMs accumulates when in deficit', () => {
    const s = { ...freshState(), demand: D(10_000) };
    const next = step(s, TICK_STEP_MS);
    expect(next.deficitMs).toBeGreaterThan(0);
  });

  it('deficitMs resets to 0 when surplus is restored', () => {
    // Start with accumulated deficit then move back to surplus.
    const s = {
      ...freshState(),
      demand: D(10_000),
      deficitMs: 30_000,
      congestionEfficiency: 0.85,
    };
    // Restore surplus by replacing demand with a small value.
    const recovered = { ...s, demand: D(10) };
    const next = step(recovered, TICK_STEP_MS);
    expect(next.deficitMs).toBe(0);
  });

  it('zero dtMs still returns a new state with no change to revenue or elapsed', () => {
    const s = freshState();
    const next = step(s, 0);
    expect(next).not.toBe(s);
    expect(next.elapsedMs).toBe(0);
    expect(next.revenue.toNumber()).toBeCloseTo(0, 10);
  });
});

// ---------------------------------------------------------------------------
// buyUpgrade()
// ---------------------------------------------------------------------------

describe('buyUpgrade()', () => {
  it('returns a new object reference', () => {
    const s = { ...freshState(), revenue: D(10_000) };
    const next = buyUpgrade(s, 'cleaner-lines');
    expect(next).not.toBe(s);
  });

  it('does not mutate the input state', () => {
    const s = { ...freshState(), revenue: D(10_000) };
    const originalRevenue = s.revenue.toNumber();
    buyUpgrade(s, 'cleaner-lines');
    expect(s.revenue.toNumber()).toBe(originalRevenue);
    expect(s.upgradeLevels['cleaner-lines']).toBeUndefined();
  });

  it('increments level from 0 to 1 on first purchase', () => {
    const s = { ...freshState(), revenue: D(10_000) };
    const next = buyUpgrade(s, 'cleaner-lines');
    expect(next.upgradeLevels['cleaner-lines']).toBe(1);
  });

  it('increments level from N to N+1 on subsequent purchase', () => {
    const s = { ...freshState(), revenue: D(10_000), upgradeLevels: { 'cleaner-lines': 3 } };
    const next = buyUpgrade(s, 'cleaner-lines');
    expect(next.upgradeLevels['cleaner-lines']).toBe(4);
  });

  it('deducts the correct cost from revenue (level 0 purchase)', () => {
    // cleaner-lines baseCost = 10
    const startRevenue = 50;
    const s = { ...freshState(), revenue: D(startRevenue) };
    const next = buyUpgrade(s, 'cleaner-lines');
    // cost at level 0 = 10 × 1.07^0 = 10
    expect(next.revenue.toNumber()).toBeCloseTo(startRevenue - 10, 8);
  });

  it('deducts correctly at an arbitrary level (level 3)', () => {
    // cleaner-lines costGrowth = 1.07, baseCost = 10
    // cost at level 3 = 10 × 1.07^3 ≈ 12.2504
    const s = {
      ...freshState(),
      revenue: D(1_000),
      upgradeLevels: { 'cleaner-lines': 3 },
    };
    const expectedCost = 10 * Math.pow(1.07, 3);
    const next = buyUpgrade(s, 'cleaner-lines');
    expect(next.revenue.toNumber()).toBeCloseTo(1_000 - expectedCost, 6);
  });

  it('is a no-op (returns unchanged state) when revenue < nextCost', () => {
    // cleaner-lines baseCost = 10; with revenue = 5 it cannot be bought
    const s = { ...freshState(), revenue: D(5) };
    const next = buyUpgrade(s, 'cleaner-lines');
    expect(next.revenue.toNumber()).toBe(5);
    expect(next.upgradeLevels['cleaner-lines']).toBeUndefined();
  });

  it('allows purchase when revenue exactly equals nextCost', () => {
    // cleaner-lines baseCost = 10 exactly
    const s = { ...freshState(), revenue: D(10) };
    const next = buyUpgrade(s, 'cleaner-lines');
    expect(next.upgradeLevels['cleaner-lines']).toBe(1);
    expect(next.revenue.toNumber()).toBeCloseTo(0, 8);
  });

  it('returns unchanged state for an unknown upgrade id', () => {
    const s = { ...freshState(), revenue: D(9_999) };
    const next = buyUpgrade(s, 'no-such-upgrade');
    expect(next.revenue.toNumber()).toBe(9_999);
    expect(Object.keys(next.upgradeLevels)).toHaveLength(0);
  });

  it('preserves all other upgradeLevels entries untouched', () => {
    const s = {
      ...freshState(),
      revenue: D(10_000),
      upgradeLevels: { 'isdn': 2, 'dedicated-line': 5 },
    };
    const next = buyUpgrade(s, 'cleaner-lines');
    expect(next.upgradeLevels['isdn']).toBe(2);
    expect(next.upgradeLevels['dedicated-line']).toBe(5);
  });

  it('increasing bandwidth after purchase raises revenue per tick', () => {
    const s = { ...freshState(), revenue: D(10_000) };
    const bwBefore = computeBandwidth(s).toNumber();
    const next = buyUpgrade(s, 'cleaner-lines');
    const bwAfter = computeBandwidth(next).toNumber();
    expect(bwAfter).toBeGreaterThan(bwBefore);
  });

  it('can purchase an expensive upgrade with sufficient revenue', () => {
    // 56k modem baseCost = 2000
    const s = { ...freshState(), revenue: D(100_000) };
    const next = buyUpgrade(s, '56k');
    expect(next.upgradeLevels['56k']).toBe(1);
    expect(gte(s.revenue, next.revenue)).toBe(true); // revenue decreased
  });
});
