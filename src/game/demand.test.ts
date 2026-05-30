/**
 * demand.test.ts
 *
 * TDD-first tests for demand.ts — smooth demand compounding.
 *
 * All tests are pure and deterministic: no wall-clock reads, no RNG.
 * Floating-point comparisons use toBeCloseTo (6 decimal precision default).
 */

import { describe, it, expect } from 'vitest';
import { D } from '../lib/bignum';
import { initialState } from './state';
import { DEMAND_GROWTH_PER_S, STARTING_DEMAND, TICK_STEP_MS } from './config';
import { riseDemand } from './demand';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract demand as a plain JS number for comparison. */
function demandNum(state: ReturnType<typeof initialState>): number {
  return state.demand.toNumber();
}

const BASE_DEMAND = STARTING_DEMAND; // 50 bps

describe('riseDemand', () => {
  // -------------------------------------------------------------------------
  // Zero dt — state must be unchanged
  // -------------------------------------------------------------------------

  describe('zero dt', () => {
    it('returns a new state object even for zero dt', () => {
      const s0 = initialState(0);
      const s1 = riseDemand(s0, 0);
      expect(s1).not.toBe(s0);
    });

    it('demand is unchanged when dtMs is 0', () => {
      const s0 = initialState(0);
      const s1 = riseDemand(s0, 0);
      expect(demandNum(s1)).toBeCloseTo(BASE_DEMAND, 6);
    });

    it('other state fields are preserved when dtMs is 0', () => {
      const s0 = initialState(1_000);
      const s1 = riseDemand(s0, 0);
      expect(s1.era).toBe(s0.era);
      expect(s1.revenue.toNumber()).toBe(s0.revenue.toNumber());
      expect(s1.upgradeLevels).toEqual(s0.upgradeLevels);
      expect(s1.congestionEfficiency).toBe(s0.congestionEfficiency);
      expect(s1.deficitMs).toBe(s0.deficitMs);
      expect(s1.elapsedMs).toBe(s0.elapsedMs);
      expect(s1.lastSaveAt).toBe(s0.lastSaveAt);
    });
  });

  // -------------------------------------------------------------------------
  // Demand rises over a single tick
  // -------------------------------------------------------------------------

  describe('single tick rise', () => {
    it('demand is strictly greater after one tick step', () => {
      const s0 = initialState(0);
      const s1 = riseDemand(s0, TICK_STEP_MS);
      expect(demandNum(s1)).toBeGreaterThan(BASE_DEMAND);
    });

    it('applies the compounding formula: demand *= rate^(dtMs/1000)', () => {
      const s0 = initialState(0);
      const dtMs = TICK_STEP_MS; // 100ms
      const s1 = riseDemand(s0, dtMs);

      const expected = BASE_DEMAND * Math.pow(DEMAND_GROWTH_PER_S, dtMs / 1000);
      expect(demandNum(s1)).toBeCloseTo(expected, 6);
    });

    it('a one-second step matches rate^1 exactly', () => {
      const s0 = initialState(0);
      const s1 = riseDemand(s0, 1_000);
      const expected = BASE_DEMAND * DEMAND_GROWTH_PER_S;
      expect(demandNum(s1)).toBeCloseTo(expected, 6);
    });
  });

  // -------------------------------------------------------------------------
  // Larger dt → proportionally more rise
  // -------------------------------------------------------------------------

  describe('larger dt produces proportionally more rise', () => {
    it('2000ms step yields more demand than 1000ms step', () => {
      const s0 = initialState(0);
      const s1k = riseDemand(s0, 1_000);
      const s2k = riseDemand(s0, 2_000);
      expect(demandNum(s2k)).toBeGreaterThan(demandNum(s1k));
    });

    it('demand from 2000ms step equals demand^rate^2 (compound interest)', () => {
      const s0 = initialState(0);
      const s2k = riseDemand(s0, 2_000);
      const expected = BASE_DEMAND * Math.pow(DEMAND_GROWTH_PER_S, 2);
      expect(demandNum(s2k)).toBeCloseTo(expected, 6);
    });

    it('demand from 60s step matches expected compound value', () => {
      const s0 = initialState(0);
      const s60 = riseDemand(s0, 60_000);
      const expected = BASE_DEMAND * Math.pow(DEMAND_GROWTH_PER_S, 60);
      // After 60s at rate 1.0005, demand ≈ 50 * ~1.03 ≈ 51.5 bps
      expect(demandNum(s60)).toBeCloseTo(expected, 4);
    });
  });

  // -------------------------------------------------------------------------
  // Compounding equivalence: one large step == many small steps
  // -------------------------------------------------------------------------

  describe('compounding consistency', () => {
    it('ten 100ms ticks equal one 1000ms tick', () => {
      const s0 = initialState(0);

      // Single large step
      const sBig = riseDemand(s0, 1_000);

      // Ten small steps
      let sSmall = s0;
      for (let i = 0; i < 10; i++) {
        sSmall = riseDemand(sSmall, 100);
      }

      // Floating-point precision: 5 decimal places is sufficient
      expect(demandNum(sSmall)).toBeCloseTo(demandNum(sBig), 5);
    });

    it('sixty 1s ticks equal one 60s tick', () => {
      const s0 = initialState(0);

      const sBig = riseDemand(s0, 60_000);

      let sSmall = s0;
      for (let i = 0; i < 60; i++) {
        sSmall = riseDemand(sSmall, 1_000);
      }

      expect(demandNum(sSmall)).toBeCloseTo(demandNum(sBig), 4);
    });
  });

  // -------------------------------------------------------------------------
  // Immutability
  // -------------------------------------------------------------------------

  describe('immutability', () => {
    it('does not mutate the input state demand', () => {
      const s0 = initialState(0);
      const originalDemand = demandNum(s0);
      riseDemand(s0, 1_000);
      expect(demandNum(s0)).toBe(originalDemand);
    });

    it('returns a distinct object reference', () => {
      const s0 = initialState(0);
      const s1 = riseDemand(s0, TICK_STEP_MS);
      expect(s1).not.toBe(s0);
    });

    it('returned demand is a distinct Decimal instance', () => {
      const s0 = initialState(0);
      const s1 = riseDemand(s0, TICK_STEP_MS);
      expect(s1.demand).not.toBe(s0.demand);
    });
  });

  // -------------------------------------------------------------------------
  // Non-standard starting demand (arbitrary state)
  // -------------------------------------------------------------------------

  describe('arbitrary starting demand', () => {
    it('correctly compounds from a non-default demand value', () => {
      const s0 = { ...initialState(0), demand: D(1_000) };
      const s1 = riseDemand(s0, 1_000);
      const expected = 1_000 * DEMAND_GROWTH_PER_S;
      expect(demandNum(s1)).toBeCloseTo(expected, 5);
    });

    it('works with very large demand values (e.g. 1e15)', () => {
      const s0 = { ...initialState(0), demand: D(1e15) };
      const s1 = riseDemand(s0, 1_000);
      const expected = 1e15 * DEMAND_GROWTH_PER_S;
      expect(demandNum(s1)).toBeCloseTo(expected, -3); // loose tolerance at this scale
    });
  });
});
