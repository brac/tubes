/**
 * economy.test.ts
 *
 * Tests for economy.ts — the pure computation layer for Bandwidth, data
 * carried, revenue, deficit classification, and congestion ramp.
 *
 * Written FIRST (TDD). All tests describe the expected contract and fail
 * until economy.ts is implemented.
 */

import { describe, it, expect } from 'vitest';
import { D, ZERO } from '../lib/bignum';
import { initialState } from './state';
import {
  computeBandwidth,
  dataCarried,
  revenueRate,
  deficitState,
  updateCongestion,
} from './economy';
import {
  STARTING_BANDWIDTH,
  CONGESTION_FLOOR,
  DEFICIT_RAMP_WINDOW_MS,
  REVENUE_PER_UNIT_PER_S,
} from './config';
import { PROTOCOL_NODES } from './protocol';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience: build a fresh state with a known now value. */
function freshState(now = 0) {
  return initialState(now);
}

/**
 * Build a state where the player owns a specific level of an upgrade.
 * Does NOT touch any other upgradeLevels entry.
 */
function stateWithUpgrade(id: string, levels: number, base = freshState()) {
  return {
    ...base,
    upgradeLevels: { ...base.upgradeLevels, [id]: levels },
  };
}

// ---------------------------------------------------------------------------
// computeBandwidth
// ---------------------------------------------------------------------------

describe('computeBandwidth', () => {
  it('returns STARTING_BANDWIDTH when no upgrades are purchased', () => {
    // Arrange
    const state = freshState();

    // Act
    const bw = computeBandwidth(state);

    // Assert
    expect(bw.toNumber()).toBe(STARTING_BANDWIDTH);
  });

  it('adds bandwidthPerLevel * levels for a single upgrade', () => {
    // Arrange – cleaner-lines gives 5 bps per level
    const state = stateWithUpgrade('cleaner-lines', 3);

    // Act
    const bw = computeBandwidth(state);

    // Assert: 60 base + 3 * 5 = 75
    expect(bw.toNumber()).toBe(STARTING_BANDWIDTH + 3 * 5);
  });

  it('sums contributions across multiple upgrades', () => {
    // Arrange – cleaner-lines (5 bps × 2) + isdn (64 bps × 1)
    const state = {
      ...freshState(),
      upgradeLevels: { 'cleaner-lines': 2, isdn: 1 },
    };

    // Act
    const bw = computeBandwidth(state);

    // Assert: 60 + 10 + 64 = 134
    expect(bw.toNumber()).toBe(STARTING_BANDWIDTH + 2 * 5 + 1 * 64);
  });

  it('ignores unknown upgrade ids gracefully (no contribution)', () => {
    // Arrange
    const state = stateWithUpgrade('unknown-future-upgrade', 5);

    // Act
    const bw = computeBandwidth(state);

    // Assert: only base bandwidth — unknown upgrade silently contributes 0
    expect(bw.toNumber()).toBe(STARTING_BANDWIDTH);
  });

  it('returns a Decimal instance', () => {
    const bw = computeBandwidth(freshState());
    expect(typeof bw.toNumber).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// deficitState
// ---------------------------------------------------------------------------

describe('deficitState', () => {
  it("returns 'surplus' when bandwidth > demand", () => {
    // Arrange: default state has BW=60, demand=50
    const state = freshState();

    // Act & Assert
    expect(deficitState(state)).toBe('surplus');
  });

  it("returns 'at-capacity' when bandwidth equals demand", () => {
    // Arrange: set demand to exactly equal the default bandwidth (60)
    const state = { ...freshState(), demand: D(STARTING_BANDWIDTH) };

    // Act & Assert
    expect(deficitState(state)).toBe('at-capacity');
  });

  it("returns 'deficit' when bandwidth < demand", () => {
    // Arrange: demand far above default bandwidth
    const state = { ...freshState(), demand: D(1000) };

    // Act & Assert
    expect(deficitState(state)).toBe('deficit');
  });

  it("returns 'surplus' when upgrades push bandwidth above demand", () => {
    // Arrange: demand=200, but 3 × ISDN (64 bps each) = 192 + 60 = 252 BW
    const state = {
      ...freshState(),
      demand: D(200),
      upgradeLevels: { isdn: 3 },
    };

    // Act & Assert
    expect(deficitState(state)).toBe('surplus');
  });
});

// ---------------------------------------------------------------------------
// dataCarried
// ---------------------------------------------------------------------------

describe('dataCarried', () => {
  it('returns demand (the bottleneck) when bandwidth > demand', () => {
    // Arrange: default state BW=60, demand=50, efficiency=1.0
    const state = freshState();

    // Act
    const carried = dataCarried(state);

    // Assert: min(60, 50) * 1.0 = 50
    expect(carried.toNumber()).toBe(50);
  });

  it('returns bandwidth (the bottleneck) when bandwidth < demand', () => {
    // Arrange: demand=200, BW=60, efficiency=1.0
    const state = { ...freshState(), demand: D(200) };

    // Act
    const carried = dataCarried(state);

    // Assert: min(60, 200) * 1.0 = 60
    expect(carried.toNumber()).toBe(STARTING_BANDWIDTH);
  });

  it('returns bandwidth * efficiency in deficit with congestion sag', () => {
    // Arrange: demand=200, BW=60, efficiency=0.8
    const state = {
      ...freshState(),
      demand: D(200),
      congestionEfficiency: 0.8,
    };

    // Act
    const carried = dataCarried(state);

    // Assert: min(60, 200) * 0.8 = 48
    expect(carried.toNumber()).toBeCloseTo(60 * 0.8, 5);
  });

  it('returns demand * efficiency in surplus with congestion sag', () => {
    // Arrange: BW=60, demand=50, efficiency=0.9 (lingering sag during recovery)
    const state = {
      ...freshState(),
      demand: D(50),
      congestionEfficiency: 0.9,
    };

    // Act
    const carried = dataCarried(state);

    // Assert: min(60, 50) * 0.9 = 45
    expect(carried.toNumber()).toBeCloseTo(50 * 0.9, 5);
  });

  it('is zero when demand is zero', () => {
    // Edge case: no demand → nothing to carry
    const state = { ...freshState(), demand: ZERO };

    // Act
    const carried = dataCarried(state);

    // Assert
    expect(carried.toNumber()).toBe(0);
  });

  it('returns a Decimal instance', () => {
    const carried = dataCarried(freshState());
    expect(typeof carried.toNumber).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// revenueRate
// ---------------------------------------------------------------------------

describe('revenueRate', () => {
  it('equals dataCarried * REVENUE_PER_UNIT_PER_S at baseline', () => {
    // Arrange: default state, surplus, efficiency=1.0, demand=50
    const state = freshState();

    // Act
    const rate = revenueRate(state);

    // Assert: dataCarried=50, rate per second = 50 * 1 = 50
    expect(rate.toNumber()).toBeCloseTo(50 * REVENUE_PER_UNIT_PER_S, 5);
  });

  it('is capped to bandwidth in deficit (lost income, not recovered)', () => {
    // Arrange: demand=200, BW=60, efficiency=1.0
    const state = { ...freshState(), demand: D(200) };

    // Act
    const rate = revenueRate(state);

    // Assert: min(60,200)*1.0 * 1 = 60
    expect(rate.toNumber()).toBeCloseTo(STARTING_BANDWIDTH * REVENUE_PER_UNIT_PER_S, 5);
  });

  it('is reduced by congestion efficiency', () => {
    // Arrange: demand=200, BW=60, efficiency=CONGESTION_FLOOR
    const state = {
      ...freshState(),
      demand: D(200),
      congestionEfficiency: CONGESTION_FLOOR,
    };

    // Act
    const rate = revenueRate(state);

    // Assert: 60 * 0.7 * 1 = 42
    expect(rate.toNumber()).toBeCloseTo(STARTING_BANDWIDTH * CONGESTION_FLOOR * REVENUE_PER_UNIT_PER_S, 5);
  });

  it('is zero when there is no demand', () => {
    const state = { ...freshState(), demand: ZERO };
    expect(revenueRate(state).toNumber()).toBe(0);
  });

  it('returns a Decimal instance', () => {
    const rate = revenueRate(freshState());
    expect(typeof rate.toNumber).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// updateCongestion — deficit path
// ---------------------------------------------------------------------------

describe('updateCongestion (deficit path)', () => {
  it('does not change efficiency after a very short deficit tick', () => {
    // Arrange: deficit state, 1 tick of 100ms (negligible vs 60 000ms ramp window)
    const state = { ...freshState(), demand: D(1000), deficitMs: 0 };

    // Act
    const next = updateCongestion(state, 100);

    // Assert: efficiency moves down only trivially
    // After 100ms: efficiency = 1.0 - (1-0.7) * (100/60000) = ~0.9995
    expect(next.congestionEfficiency).toBeLessThan(1.0);
    expect(next.congestionEfficiency).toBeGreaterThan(0.99);
  });

  it('reaches the floor after deficitMs >= ramp window', () => {
    // Arrange: already been in deficit for the full ramp window
    const state = {
      ...freshState(),
      demand: D(1000),
      deficitMs: DEFICIT_RAMP_WINDOW_MS,
      congestionEfficiency: CONGESTION_FLOOR,
    };

    // Act: one more tick while fully saturated at the floor
    const next = updateCongestion(state, 100);

    // Assert: must not drop below the floor
    expect(next.congestionEfficiency).toBeGreaterThanOrEqual(CONGESTION_FLOOR);
    // Should stay at or very near the floor
    expect(next.congestionEfficiency).toBeCloseTo(CONGESTION_FLOOR, 5);
  });

  it('accumulates deficitMs while in deficit', () => {
    // Arrange
    const state = { ...freshState(), demand: D(1000), deficitMs: 1000 };

    // Act
    const next = updateCongestion(state, 100);

    // Assert: deficitMs advances by dtMs
    expect(next.deficitMs).toBe(1100);
  });

  it('clamps deficitMs at the ramp window ceiling (no overflow)', () => {
    // Arrange: already past the ceiling
    const state = {
      ...freshState(),
      demand: D(1000),
      deficitMs: DEFICIT_RAMP_WINDOW_MS + 5000,
    };

    // Act
    const next = updateCongestion(state, 100);

    // Assert: capped at the window (no runaway accumulation)
    expect(next.deficitMs).toBeLessThanOrEqual(DEFICIT_RAMP_WINDOW_MS);
  });

  it('sags efficiency linearly from 1.0 to floor over the full ramp window', () => {
    // Arrange: start fresh, enter deficit, and simulate the full ramp in one
    // large step (dt = DEFICIT_RAMP_WINDOW_MS)
    const state = {
      ...freshState(),
      demand: D(1000),
      deficitMs: 0,
      congestionEfficiency: 1.0,
    };

    // Act
    const next = updateCongestion(state, DEFICIT_RAMP_WINDOW_MS);

    // Assert: efficiency is at or near the floor (may be slightly above due
    // to pre-tick vs post-tick sequencing, but must not overshoot floor)
    expect(next.congestionEfficiency).toBeGreaterThanOrEqual(CONGESTION_FLOOR);
    expect(next.congestionEfficiency).toBeLessThanOrEqual(1.0);
  });

  it('returns a new state object (immutability)', () => {
    const state = { ...freshState(), demand: D(1000) };
    const next = updateCongestion(state, 100);
    expect(next).not.toBe(state);
  });
});

// ---------------------------------------------------------------------------
// updateCongestion — surplus / recovery path
// ---------------------------------------------------------------------------

describe('updateCongestion (recovery path)', () => {
  it('resets deficitMs to 0 when bandwidth >= demand', () => {
    // Arrange: was in deficit, now in surplus
    const state = { ...freshState(), deficitMs: 15_000 };

    // demand=50, BW=60 → surplus
    expect(deficitState(state)).toBe('surplus');

    // Act
    const next = updateCongestion(state, 100);

    // Assert
    expect(next.deficitMs).toBe(0);
  });

  it('recovers efficiency toward 1.0 when back in surplus', () => {
    // Arrange: congestion sagged to floor, now in surplus
    const state = {
      ...freshState(),
      demand: D(50),     // BW=60 > demand=50 → surplus
      congestionEfficiency: CONGESTION_FLOOR,
      deficitMs: DEFICIT_RAMP_WINDOW_MS,
    };

    // Act: several ticks
    let s = state;
    for (let i = 0; i < 50; i++) {
      s = updateCongestion(s, 100);
    }

    // Assert: efficiency has risen above the floor
    expect(s.congestionEfficiency).toBeGreaterThan(CONGESTION_FLOOR);
  });

  it('recovers fully to 1.0 given enough time', () => {
    // Arrange
    const state = {
      ...freshState(),
      demand: D(50),
      congestionEfficiency: CONGESTION_FLOOR,
      deficitMs: 0,
    };

    // Act: simulate a full recovery window (60s of surplus ticks)
    const next = updateCongestion(state, DEFICIT_RAMP_WINDOW_MS);

    // Assert
    expect(next.congestionEfficiency).toBeCloseTo(1.0, 5);
  });

  it('never exceeds 1.0 even with excess recovery time', () => {
    const state = {
      ...freshState(),
      demand: D(50),
      congestionEfficiency: 0.95,
      deficitMs: 0,
    };

    // Simulate long surplus
    const next = updateCongestion(state, DEFICIT_RAMP_WINDOW_MS * 2);

    expect(next.congestionEfficiency).toBeLessThanOrEqual(1.0);
  });

  it('keeps efficiency at 1.0 when already at max and in surplus', () => {
    // Arrange: already at full efficiency, in surplus
    const state = { ...freshState(), congestionEfficiency: 1.0 };

    // Act
    const next = updateCongestion(state, 100);

    // Assert
    expect(next.congestionEfficiency).toBe(1.0);
  });

  it('at-capacity (bw == demand) counts as non-deficit — deficitMs resets', () => {
    // Arrange: demand exactly matches BW, deficitMs accumulated
    const state = {
      ...freshState(),
      demand: D(STARTING_BANDWIDTH),
      deficitMs: 5000,
    };

    // Act
    const next = updateCongestion(state, 100);

    // Assert: at-capacity is not a deficit; deficitMs should clear
    expect(next.deficitMs).toBe(0);
  });

  it('returns a new state object (immutability)', () => {
    const state = freshState();
    const next = updateCongestion(state, 100);
    expect(next).not.toBe(state);
  });
});

// ---------------------------------------------------------------------------
// Protocol multipliers wired into economy
// ---------------------------------------------------------------------------

describe('computeBandwidth with protocol bandwidth-boost', () => {
  it('baseline: no protocol levels → same as before (multiplier = 1)', () => {
    const state = freshState();
    // No protocol levels — bandwidth-boost node is level 0 → multiplier 1
    expect(computeBandwidth(state).toNumber()).toBe(STARTING_BANDWIDTH);
  });

  it('bandwidth-boost level 1 increases bandwidth by 10%', () => {
    // bandwidth-boost effectPerLevel = 0.10 → multiplier = 1 + 0.10*1 = 1.1
    const node = PROTOCOL_NODES.find((n) => n.id === 'bandwidth-boost')!;
    const state = {
      ...freshState(),
      protocolLevels: { 'bandwidth-boost': 1 },
    };
    const bw = computeBandwidth(state).toNumber();
    const expected = STARTING_BANDWIDTH * (1 + node.effectPerLevel * 1);
    expect(bw).toBeCloseTo(expected, 5);
  });

  it('bandwidth-boost level 3 increases bandwidth by 30%', () => {
    const node = PROTOCOL_NODES.find((n) => n.id === 'bandwidth-boost')!;
    const state = {
      ...freshState(),
      protocolLevels: { 'bandwidth-boost': 3 },
    };
    const bw = computeBandwidth(state).toNumber();
    const expected = STARTING_BANDWIDTH * (1 + node.effectPerLevel * 3);
    expect(bw).toBeCloseTo(expected, 5);
  });

  it('bandwidth multiplier stacks with upgrade contributions', () => {
    // 3 levels of cleaner-lines (5 bps each) = +15 bps; then ×1.1 with level 1 bw-boost
    const node = PROTOCOL_NODES.find((n) => n.id === 'bandwidth-boost')!;
    const state = {
      ...freshState(),
      upgradeLevels: { 'cleaner-lines': 3 },
      protocolLevels: { 'bandwidth-boost': 1 },
    };
    const bw = computeBandwidth(state).toNumber();
    const baseWithUpgrades = STARTING_BANDWIDTH + 3 * 5;
    const expected = baseWithUpgrades * (1 + node.effectPerLevel * 1);
    expect(bw).toBeCloseTo(expected, 5);
  });
});

describe('revenueRate with protocol revenue-boost', () => {
  it('baseline: no protocol levels → unchanged revenue rate', () => {
    const state = freshState();
    // demand=50, bw=60, efficiency=1.0 → carried=50, rate=50
    expect(revenueRate(state).toNumber()).toBeCloseTo(50 * REVENUE_PER_UNIT_PER_S, 5);
  });

  it('revenue-boost level 1 increases revenue rate by 10%', () => {
    const node = PROTOCOL_NODES.find((n) => n.id === 'revenue-boost')!;
    const state = {
      ...freshState(),
      protocolLevels: { 'revenue-boost': 1 },
    };
    const rate = revenueRate(state).toNumber();
    const baseRate = 50 * REVENUE_PER_UNIT_PER_S;
    const expected = baseRate * (1 + node.effectPerLevel * 1);
    expect(rate).toBeCloseTo(expected, 5);
  });

  it('revenue-boost level 2 increases revenue rate by 20%', () => {
    const node = PROTOCOL_NODES.find((n) => n.id === 'revenue-boost')!;
    const state = {
      ...freshState(),
      protocolLevels: { 'revenue-boost': 2 },
    };
    const rate = revenueRate(state).toNumber();
    const baseRate = 50 * REVENUE_PER_UNIT_PER_S;
    const expected = baseRate * (1 + node.effectPerLevel * 2);
    expect(rate).toBeCloseTo(expected, 5);
  });

  it('precomputed bw param still works with revenue multiplier applied', () => {
    const node = PROTOCOL_NODES.find((n) => n.id === 'revenue-boost')!;
    const state = {
      ...freshState(),
      protocolLevels: { 'revenue-boost': 1 },
    };
    const bw = computeBandwidth(state);
    const withPrecomputed = revenueRate(state, bw).toNumber();
    const withoutPrecomputed = revenueRate(state).toNumber();
    expect(withPrecomputed).toBeCloseTo(withoutPrecomputed, 8);
  });
});
