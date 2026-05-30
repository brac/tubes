/**
 * offline.ts
 *
 * Pure functions for computing and applying offline earnings.
 *
 * PURE MODULE — reads NO clock, no Date.now(), no performance.now().
 * The caller (boot path in main.ts / store.ts) is responsible for
 * supplying elapsedMs derived from wall-clock epochs.
 *
 * Clock rule: the only places that may read wall-clock epochs are
 *   - src/game/store.ts  (save stamping)
 *   - src/main.ts        (boot / initial elapsedMs computation)
 *
 * Exports:
 *   computeOfflineEarnings  — returns gained Decimal + cappedMs used
 *   applyOfflineEarnings    — convenience wrapper that patches state.revenue
 */

import { D, add, mul } from '../lib/bignum';
import type { Decimal } from '../lib/bignum';
import type { GameState } from './state';
import { revenueRate } from './economy';
import { offlineMultiplier } from './protocol';
import { OFFLINE_CAP_MS, OFFLINE_EFFICIENCY } from './config';

// ---------------------------------------------------------------------------
// computeOfflineEarnings
// ---------------------------------------------------------------------------

/**
 * Result of an offline-earnings computation.
 */
export interface OfflineEarningsResult {
  /**
   * Revenue to award the player for the time spent offline.
   * Computed as:
   *   revenueRate(saved) × (cappedMs / 1000) × OFFLINE_EFFICIENCY × offlineMultiplier(saved)
   */
  gained: Decimal;

  /**
   * The elapsed milliseconds actually used after clamping.
   * Useful for "While you were away…" UI copy (e.g. "You were away for 4h 30m").
   */
  cappedMs: number;
}

/**
 * computeOfflineEarnings(saved, elapsedMs)
 *
 * Computes how much Revenue to award for time spent offline.
 *
 * Clamping rules:
 *   - Negative elapsedMs (possible from clock skew) → treated as 0.
 *   - elapsedMs > OFFLINE_CAP_MS                    → clamped to OFFLINE_CAP_MS.
 *
 * Earnings formula:
 *   gained = revenueRate(saved) × (cappedMs / 1000) × OFFLINE_EFFICIENCY × offlineMultiplier(saved)
 *
 * Rationale: we use the rate AT save time so the offline credit is
 * deterministic and comparable across sessions without replaying the tick loop.
 *
 * @param saved      The GameState snapshot loaded from the save store.
 * @param elapsedMs  Real milliseconds since the save was written (wall-clock delta).
 * @returns          { gained, cappedMs } — both values are needed by the UI summary.
 */
export function computeOfflineEarnings(
  saved: GameState,
  elapsedMs: number,
): OfflineEarningsResult {
  // Clamp: [0, OFFLINE_CAP_MS]
  const cappedMs = Math.min(Math.max(0, elapsedMs), OFFLINE_CAP_MS);

  if (cappedMs === 0) {
    return { gained: D(0), cappedMs: 0 };
  }

  // Rate at save time (Revenue per second)
  const rate: Decimal = revenueRate(saved);

  // Offline multiplier from the Protocol "offline-boost" node (≥ 1)
  const boost: Decimal = offlineMultiplier(saved);

  // gained = rate × seconds × OFFLINE_EFFICIENCY × boost
  const elapsedSeconds: Decimal = D(cappedMs / 1000);
  const efficiency: Decimal = D(OFFLINE_EFFICIENCY);

  const gained: Decimal = mul(mul(mul(rate, elapsedSeconds), efficiency), boost);

  return { gained, cappedMs };
}

// ---------------------------------------------------------------------------
// applyOfflineEarnings
// ---------------------------------------------------------------------------

/**
 * Result of applying offline earnings to a saved GameState.
 */
export interface ApplyOfflineResult {
  /** New GameState with revenue incremented by gained (immutable — input unchanged). */
  state: GameState;

  /** Revenue credited (same as computeOfflineEarnings.gained). */
  gained: Decimal;

  /** Clamped elapsed milliseconds used (same as computeOfflineEarnings.cappedMs). */
  cappedMs: number;
}

/**
 * applyOfflineEarnings(saved, elapsedMs)
 *
 * Convenience function for the boot path.
 *
 * Calls computeOfflineEarnings and returns a NEW GameState with
 * state.revenue increased by the earned amount. All other fields are
 * preserved verbatim — this function does not advance demand, congestion,
 * eraGate, etc. (that is the tick loop's responsibility).
 *
 * Immutability contract: the `saved` argument is NEVER mutated.
 *
 * @param saved      The GameState snapshot loaded from the save store.
 * @param elapsedMs  Real milliseconds since the save was written.
 * @returns          { state, gained, cappedMs }
 */
export function applyOfflineEarnings(
  saved: GameState,
  elapsedMs: number,
): ApplyOfflineResult {
  const { gained, cappedMs } = computeOfflineEarnings(saved, elapsedMs);

  const state: GameState = {
    ...saved,
    revenue: add(saved.revenue, gained),
  };

  return { state, gained, cappedMs };
}
