/**
 * state.ts
 *
 * GameState type definition and initialState factory.
 *
 * GameState is a PLAIN IMMUTABLE OBJECT. Reducers and step functions must
 * always return a NEW state; never mutate an existing one.
 *
 * Bandwidth is intentionally NOT stored — it is always derived from upgrades
 * via economy.ts#computeBandwidth(state) to avoid stale/redundant state.
 */

import { D, ZERO } from '../lib/bignum';
import type { Decimal } from '../lib/bignum';
import { STARTING_DEMAND } from './config';

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/**
 * GameState — the complete, serialisable snapshot of the simulation.
 *
 * All Decimal fields represent in-game numbers that may grow beyond JS
 * float precision. Plain numeric fields (era, elapsedMs, etc.) stay as
 * number because they won't exceed safe integer range in any reasonable
 * play session.
 */
export interface GameState {
  /**
   * Accumulated spendable currency.
   * Grows each tick at the Revenue rate; decreases on upgrade purchases.
   */
  revenue: Decimal;

  /**
   * Current Demand (bps). Rises continuously via demand.ts.
   * Initialised to the era's baseDemand; compounded each tick.
   */
  demand: Decimal;

  /**
   * Current era number (1-indexed). Only era 1 exists in Phase 1.
   * Never decreases — eras are the permanent forward axis.
   */
  era: number;

  /**
   * Number of levels owned for each upgrade, keyed by upgrade id.
   * Missing key ≡ 0 levels. Reducers spread this record immutably.
   *
   * Example: { 'cleaner-lines': 3, 'dedicated-line': 1 }
   */
  upgradeLevels: Record<string, number>;

  /**
   * Current carrying efficiency, between CONGESTION_FLOOR and 1.0.
   * Starts at 1.0 (full efficiency). Sags on sustained deficit,
   * recovers immediately once Bandwidth ≥ Demand.
   */
  congestionEfficiency: number;

  /**
   * Milliseconds the simulation has been continuously in deficit.
   * Resets to 0 whenever Bandwidth ≥ Demand is restored.
   * Used to drive the congestion ramp in economy.ts.
   */
  deficitMs: number;

  /**
   * Total simulation time advanced since initialState was created (ms).
   * Incremented by the tick loop each step.
   */
  elapsedMs: number;

  /**
   * Wall-clock epoch (ms) when the state was last persisted to IndexedDB.
   * Set by the persistence layer, NOT by pure logic modules.
   * Pure modules receive this as an argument rather than reading it here,
   * so they remain deterministic and testable.
   */
  lastSaveAt: number;

  // -------------------------------------------------------------------------
  // Phase-3 fields
  // -------------------------------------------------------------------------

  /**
   * Permanent currency earned on prestige ("Rebuild the Backbone").
   * Persists across all resets — never lost on prestige.
   * Spent in the Protocol tree on permanent multipliers.
   */
  protocol: Decimal;

  /**
   * Levels owned for each Protocol-tree node, keyed by node id.
   * Missing key ≡ 0 levels. Updated immutably by protocol.ts#buyProtocol.
   * Persists across all resets — never lost on prestige.
   *
   * Example: { 'revenue-boost': 2, 'bandwidth-boost': 1 }
   */
  protocolLevels: Record<string, number>;

  /**
   * The highest revenueRate (Revenue per second) observed during the
   * current run. Tracked each tick; resets to ZERO on prestige.
   * Drives the sub-linear Protocol payout formula in prestige.ts.
   */
  runPeakRevenueRate: Decimal;

  /**
   * Continuous milliseconds the player has maintained Bandwidth >= Demand.
   * Incremented each tick while not in deficit; resets to 0 the moment
   * a deficit occurs. When this reaches ERA_GATE_WINDOW_MS the era advances.
   */
  eraGateMs: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * initialState(now) — returns a fresh, immutable GameState for the start of
 * a new game in era 1 with zero upgrades purchased.
 *
 * @param now  Current wall-clock time in milliseconds (e.g. Date.now()).
 *             Passed in by the caller so this function stays pure and testable.
 */
export function initialState(now: number): GameState {
  return {
    revenue: ZERO,
    demand: D(STARTING_DEMAND),
    era: 1,
    upgradeLevels: {},
    congestionEfficiency: 1.0,
    deficitMs: 0,
    elapsedMs: 0,
    lastSaveAt: now,
    // Phase-3 fields
    protocol: ZERO,
    protocolLevels: {},
    runPeakRevenueRate: ZERO,
    eraGateMs: 0,
  };
}
