/**
 * demand.ts
 *
 * Pure demand-evolution functions for Phase 1.
 *
 * Rules:
 * - No wall-clock reads (Date.now, performance.now, etc.) — time deltas are
 *   passed in as arguments so every function is deterministic and testable.
 * - No RNG.
 * - All functions return a NEW GameState; the input is never mutated.
 * - Big numbers go through src/lib/bignum.ts helpers only.
 */

import { D, mul, pow } from '../lib/bignum';
import { DEMAND_GROWTH_PER_S } from './config';
import type { GameState } from './state';

// ---------------------------------------------------------------------------
// riseDemand — smooth continuous compounding
// ---------------------------------------------------------------------------

/**
 * riseDemand(state, dtMs) — advance Demand by one time step.
 *
 * Uses the continuous-compounding formula:
 *   demand_new = demand_old × DEMAND_GROWTH_PER_S ^ (dtMs / 1000)
 *
 * This means:
 *   - Applying ten 100ms steps is mathematically identical to one 1000ms step.
 *   - A zero dt returns the same demand (rate^0 = 1).
 *   - An idle player falls meaningfully behind in minutes at DEMAND_GROWTH_PER_S = 1.0005
 *     (~+3% per minute, ~+19% per hour).
 *
 * @param state  Current immutable game state.
 * @param dtMs   Time delta in milliseconds since the last tick. Must be ≥ 0.
 * @returns      A new GameState with only `demand` updated.
 */
export function riseDemand(state: GameState, dtMs: number): GameState {
  if (dtMs === 0) {
    // Return a structurally new object to satisfy the "always-new-reference"
    // contract, but demand value is identical — avoids a needless Decimal alloc.
    return { ...state };
  }

  const dtSec = dtMs / 1000;
  // rate^dtSec: use bignum pow so very large dtSec stays precise.
  const growthFactor = pow(D(DEMAND_GROWTH_PER_S), D(dtSec));
  const newDemand = mul(state.demand, growthFactor);

  return { ...state, demand: newDemand };
}

// ---------------------------------------------------------------------------
// eraJump — Phase 3 stub
// ---------------------------------------------------------------------------

/**
 * eraJump(state) — apply the demand step-jump when a new era begins.
 *
 * Phase 1: STUB ONLY — do not call this yet. The era-gate logic and
 * `nextEraDemandMultiplier` are wired up in Phase 3 (prestige / era unlock).
 *
 * When implemented, this will:
 *   1. Look up the current era's `nextEraDemandMultiplier` from eras.ts.
 *   2. Multiply demand by that factor.
 *   3. Increment state.era.
 *   4. Return the new state.
 */
export function eraJump(_state: GameState): GameState {
  throw new Error('eraJump is not implemented until Phase 3');
}
