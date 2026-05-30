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
import { TICK_STEP_MS, ERA_GATE_WINDOW_MS } from './config';
import { computeBandwidth, revenueRate } from './economy';
import { PROTOCOL_NODES } from './protocol';

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

  it('buyUpgrade respects protocol cost discount (upgrade-discount node)', () => {
    // upgrade-discount effectPerLevel = 0.03: level 1 → cost × 0.97, level 10 → cost × 0.70 (floor)
    // cleaner-lines baseCost = 10
    const discountNode = PROTOCOL_NODES.find((n) => n.id === 'upgrade-discount')!;

    const noDiscount = { ...freshState(), revenue: D(10_000) };
    const withDiscount = {
      ...freshState(),
      revenue: D(10_000),
      protocolLevels: { 'upgrade-discount': 5 },
    };

    const nextNoDiscount = buyUpgrade(noDiscount, 'cleaner-lines');
    const nextWithDiscount = buyUpgrade(withDiscount, 'cleaner-lines');

    // With discount, the revenue deducted should be less
    const spentNoDiscount = 10_000 - nextNoDiscount.revenue.toNumber();
    const spentWithDiscount = 10_000 - nextWithDiscount.revenue.toNumber();

    expect(spentWithDiscount).toBeLessThan(spentNoDiscount);

    // Verify the multiplier is correctly applied: 1 - 0.03*5 = 0.85
    const expectedMultiplier = Math.max(0.5, 1 - discountNode.effectPerLevel * 5);
    expect(spentWithDiscount).toBeCloseTo(spentNoDiscount * expectedMultiplier, 5);
  });

  it('buyUpgrade allows purchase with sufficient discounted cost even if raw cost is too high', () => {
    // baseCost 10, player has exactly 8.5 revenue — unaffordable normally (cost 10)
    // With upgrade-discount level 5 → multiplier 0.85 → cost 8.5 → barely affordable
    const state = {
      ...freshState(),
      revenue: D(8.5),
      protocolLevels: { 'upgrade-discount': 5 },
    };
    const next = buyUpgrade(state, 'cleaner-lines');
    // Should succeed because discounted cost = 10 * 0.85 = 8.5 which equals revenue
    expect(next.upgradeLevels['cleaner-lines']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// step() — Phase 3: runPeakRevenueRate tracking
// ---------------------------------------------------------------------------

describe('step() runPeakRevenueRate tracking', () => {
  it('runPeakRevenueRate starts at ZERO in initial state', () => {
    const s = freshState();
    expect(s.runPeakRevenueRate.toNumber()).toBe(0);
  });

  it('runPeakRevenueRate is updated after first tick', () => {
    const s = freshState();
    const next = step(s, TICK_STEP_MS);
    expect(next.runPeakRevenueRate.toNumber()).toBeGreaterThan(0);
  });

  it('runPeakRevenueRate is monotonically non-decreasing', () => {
    let s = freshState();
    let prev = s.runPeakRevenueRate.toNumber();
    for (let i = 0; i < 10; i++) {
      s = step(s, TICK_STEP_MS);
      expect(s.runPeakRevenueRate.toNumber()).toBeGreaterThanOrEqual(prev);
      prev = s.runPeakRevenueRate.toNumber();
    }
  });

  it('runPeakRevenueRate does not decrease when revenue rate drops', () => {
    // Get to a high revenue rate
    let s = { ...freshState(), demand: D(1000), upgradeLevels: { 'isdn': 5 } as Record<string, number> };
    s = step(s, TICK_STEP_MS);
    const peak = s.runPeakRevenueRate.toNumber();

    // Now reduce bandwidth (simulate low demand state)
    s = { ...s, demand: D(1), upgradeLevels: {} as Record<string, number> };
    s = step(s, TICK_STEP_MS);

    // Peak must not decrease
    expect(s.runPeakRevenueRate.toNumber()).toBeGreaterThanOrEqual(peak);
  });

  it('runPeakRevenueRate equals current rate when rate is a new maximum', () => {
    const s = freshState();
    const next = step(s, TICK_STEP_MS);
    // Since we start at 0, the first tick's rate is necessarily the max
    const rate = revenueRate(next).toNumber();
    expect(next.runPeakRevenueRate.toNumber()).toBeCloseTo(rate, 4);
  });

  it('revenue-boost Protocol levels increase ACTUAL per-tick income, not just peak', () => {
    // Regression: step() must accrue income via revenueRate (with the Protocol
    // revenue multiplier), otherwise revenue-boost is silently inert.
    const base = freshState();
    const boosted = { ...base, protocolLevels: { 'revenue-boost': 5 } as Record<string, number> };

    const baseGain = step(base, TICK_STEP_MS).revenue.toNumber();
    const boostedGain = step(boosted, TICK_STEP_MS).revenue.toNumber();

    expect(boostedGain).toBeGreaterThan(baseGain);
  });
});

// ---------------------------------------------------------------------------
// step() — Phase 3: eraGateMs tracking
// ---------------------------------------------------------------------------

describe('step() eraGateMs accumulation and reset', () => {
  it('eraGateMs starts at 0', () => {
    expect(freshState().eraGateMs).toBe(0);
  });

  it('eraGateMs increases by dtMs when bandwidth >= demand (surplus)', () => {
    // Default state: BW=60 > demand=50 → surplus
    const s = freshState();
    const next = step(s, TICK_STEP_MS);
    expect(next.eraGateMs).toBe(TICK_STEP_MS);
  });

  it('eraGateMs accumulates across multiple ticks in surplus', () => {
    let s = freshState(); // BW=60 > demand=50
    // Prevent era from advancing by working with era without next
    // Actually era 1 has next (era 2), so we need to keep eraGateMs below threshold
    // Use just 3 ticks (300ms) which is well below ERA_GATE_WINDOW_MS (30s)
    for (let i = 0; i < 3; i++) {
      s = step(s, TICK_STEP_MS);
    }
    expect(s.eraGateMs).toBe(3 * TICK_STEP_MS);
  });

  it('eraGateMs resets to 0 when bandwidth < demand (deficit)', () => {
    // Start with some accumulated gate time, then enter deficit
    const s = {
      ...freshState(),
      demand: D(10_000), // far above BW=60 → deficit
      eraGateMs: 5_000,
    };
    const next = step(s, TICK_STEP_MS);
    expect(next.eraGateMs).toBe(0);
  });

  it('eraGateMs does not accumulate in deficit', () => {
    const s = { ...freshState(), demand: D(10_000), eraGateMs: 0 };
    const next = step(s, TICK_STEP_MS);
    expect(next.eraGateMs).toBe(0);
  });

  it('eraGateMs accumulates at-capacity (bandwidth == demand after rise)', () => {
    // demand rises slightly each tick; choose a demand low enough that after
    // one tick it still does not exceed STARTING_BANDWIDTH.
    // STARTING_BANDWIDTH = 60, DEMAND_GROWTH_PER_S = 1.0005,
    // demand after 100ms tick = demand * 1.0005^0.1 ≈ demand * 1.00005
    // Set demand = 59.996 so after growth it's ~60.00 (still <= BW=60)
    const s = { ...freshState(), demand: D(59.99), eraGateMs: 0 };
    const next = step(s, TICK_STEP_MS);
    // BW=60 >= demand after rise → gate should advance
    expect(next.eraGateMs).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// step() — Phase 3: era advancement
// ---------------------------------------------------------------------------

describe('step() era advancement', () => {
  it('era does not advance before ERA_GATE_WINDOW_MS is reached', () => {
    const s = freshState(); // surplus: BW=60 > demand=50
    // Run for ERA_GATE_WINDOW_MS - one step (just below threshold)
    const almostThere = {
      ...s,
      eraGateMs: ERA_GATE_WINDOW_MS - TICK_STEP_MS,
    };
    const next = step(almostThere, TICK_STEP_MS);
    // After this step eraGateMs reaches exactly ERA_GATE_WINDOW_MS
    // The step that first reaches the threshold DOES advance the era
    // So let's check one step before: eraGateMs = ERA_GATE_WINDOW_MS - 2*TICK_STEP_MS
    const twoShort = { ...s, eraGateMs: ERA_GATE_WINDOW_MS - 2 * TICK_STEP_MS };
    const notYet = step(twoShort, TICK_STEP_MS);
    expect(notYet.era).toBe(1);
  });

  it('era advances from 1 to 2 when eraGateMs reaches threshold in surplus', () => {
    // Place eraGateMs just one tick below the threshold; next step crosses it
    const s = {
      ...freshState(),
      eraGateMs: ERA_GATE_WINDOW_MS - TICK_STEP_MS,
    };
    const next = step(s, TICK_STEP_MS);
    expect(next.era).toBe(2);
  });

  it('eraGateMs resets to 0 after era advance', () => {
    const s = {
      ...freshState(),
      eraGateMs: ERA_GATE_WINDOW_MS - TICK_STEP_MS,
    };
    const next = step(s, TICK_STEP_MS);
    expect(next.eraGateMs).toBe(0);
  });

  it('demand steps up when era advances (eraJump applied)', () => {
    const s = {
      ...freshState(),
      eraGateMs: ERA_GATE_WINDOW_MS - TICK_STEP_MS,
    };
    const demandBefore = s.demand.toNumber();
    const next = step(s, TICK_STEP_MS);
    // demand should be significantly higher after era jump (×10 multiplier)
    expect(next.demand.toNumber()).toBeGreaterThan(demandBefore * 5);
  });

  it('era does NOT advance past the last era (no next era available)', () => {
    // Simulate being in the last era (era 2 in the current ERA_TABLE)
    // with eraGateMs already at threshold
    const s = {
      ...freshState(),
      era: 2,
      eraGateMs: ERA_GATE_WINDOW_MS - TICK_STEP_MS,
      // Ensure surplus so gate would accumulate: bw must exceed demand
      demand: D(10),
    };
    const next = step(s, TICK_STEP_MS);
    // Should stay at era 2; no era 3 exists
    expect(next.era).toBe(2);
  });

  it('eras never regress (step never decrements era)', () => {
    const s = { ...freshState(), era: 2 };
    const next = step(s, TICK_STEP_MS);
    expect(next.era).toBeGreaterThanOrEqual(2);
  });
});
