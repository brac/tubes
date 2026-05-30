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
import { getEra } from './eras';
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
// eraJump — apply the demand step-jump when leaving an era
// ---------------------------------------------------------------------------

/**
 * eraJump(state) — apply the demand step-jump when a new era begins.
 *
 * Looks up the CURRENT era's `nextEraDemandMultiplier` (the era being LEFT)
 * and multiplies demand by that factor. The era field itself is NOT
 * incremented here — era advancement (era += 1) is the tick loop's
 * responsibility so that all related fields update atomically.
 *
 * Pure and immutable: returns a new GameState, never mutates the input.
 *
 * @param state  Current game state (era must be a valid era id in ERA_TABLE).
 * @returns      New GameState with demand multiplied by the era's jump factor.
 * @throws       If state.era is not found in ERA_TABLE.
 */
export function eraJump(state: GameState): GameState {
  const eraDef = getEra(state.era); // throws for unknown era id
  const newDemand = mul(state.demand, D(eraDef.nextEraDemandMultiplier));
  return { ...state, demand: newDemand };
}
