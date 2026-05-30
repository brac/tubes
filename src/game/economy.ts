/**
 * economy.ts
 *
 * Pure computation layer for the Bandwidth–Demand core loop.
 *
 * All exports are pure functions: they accept state (and optional dtMs) and
 * return a number, Decimal, string literal, or new GameState. They NEVER read
 * the wall-clock, access RNG, or mutate their inputs. Determinism is required
 * for testability and eventual offline-progress catch-up.
 *
 * Key derived quantities (never stored in GameState):
 *   Bandwidth        — sum of all upgrade contributions + base (computeBandwidth)
 *   Data Carried     — min(bandwidth, demand) * congestionEfficiency (dataCarried)
 *   Revenue Rate     — dataCarried * REVENUE_PER_UNIT_PER_S (revenueRate)
 */

import { D, add, mul, min, cmp } from '../lib/bignum';
import type { Decimal } from '../lib/bignum';
import type { GameState } from './state';
import { ERA1_UPGRADES } from './upgrades';
import {
  STARTING_BANDWIDTH,
  REVENUE_PER_UNIT_PER_S,
  CONGESTION_FLOOR,
  DEFICIT_RAMP_WINDOW_MS,
} from './config';
import { bandwidthMultiplier, revenueMultiplier } from './protocol';

// ---------------------------------------------------------------------------
// Bandwidth
// ---------------------------------------------------------------------------

/**
 * computeBandwidth(state) — total available bandwidth in bps.
 *
 * Formula:
 *   STARTING_BANDWIDTH
 *   + Σ (levels owned for upgrade) × (upgrade.bandwidthPerLevel)
 *     for all era-1 upgrades where the id is present in upgradeLevels.
 *
 * Unknown ids in upgradeLevels (future upgrades, typos) are silently ignored
 * so old saved states don't break when the upgrade catalog is extended.
 */
export function computeBandwidth(state: GameState): Decimal {
  let bw: Decimal = D(STARTING_BANDWIDTH);

  for (const upgrade of ERA1_UPGRADES) {
    const levels = state.upgradeLevels[upgrade.id] ?? 0;
    if (levels > 0) {
      // contribution = levels * bandwidthPerLevel
      bw = add(bw, mul(D(levels), upgrade.bandwidthPerLevel));
    }
  }

  // Apply Protocol bandwidth multiplier (>= 1; no-op at level 0)
  bw = mul(bw, bandwidthMultiplier(state));

  return bw;
}

// ---------------------------------------------------------------------------
// Deficit classification
// ---------------------------------------------------------------------------

/**
 * deficitState(state) — classify current capacity relative to demand.
 *
 *   'surplus'     — bandwidth > demand (healthy, full revenue)
 *   'at-capacity' — bandwidth = demand (no income loss, no congestion)
 *   'deficit'     — bandwidth < demand (capped income; congestion ramps up)
 */
export type DeficitStatus = 'surplus' | 'at-capacity' | 'deficit';

export function deficitState(state: GameState, bw?: Decimal): DeficitStatus {
  const bandwidth = bw ?? computeBandwidth(state);
  const result = cmp(bandwidth, state.demand);

  if (result > 0) return 'surplus';
  if (result === 0) return 'at-capacity';
  return 'deficit';
}

// ---------------------------------------------------------------------------
// Data Carried
// ---------------------------------------------------------------------------

/**
 * dataCarried(state) — effective bits per second actually transported.
 *
 * Formula:
 *   min(bandwidth, demand) * congestionEfficiency
 *
 * In surplus the bottleneck is demand (no wasted capacity paid for).
 * In deficit the bottleneck is bandwidth (income capped; no make-up later).
 * congestionEfficiency scales the whole thing down when sustained deficit
 * has degraded network quality.
 */
export function dataCarried(state: GameState, bw?: Decimal): Decimal {
  const bandwidth = bw ?? computeBandwidth(state);
  const bottleneck = min(bandwidth, state.demand);
  return mul(bottleneck, D(state.congestionEfficiency));
}

// ---------------------------------------------------------------------------
// Revenue Rate
// ---------------------------------------------------------------------------

/**
 * revenueRate(state) — Revenue earned per second at the current tick.
 *
 * Formula:
 *   dataCarried(state) * REVENUE_PER_UNIT_PER_S
 *
 * Revenue rate is a snapshot: multiply by (dtMs / 1000) to get Revenue
 * accumulated over a tick in the tick loop.
 *
 * No era multipliers in Phase 1; they will be layered on top in Phase 4.
 */
export function revenueRate(state: GameState, bw?: Decimal): Decimal {
  const base = mul(dataCarried(state, bw), D(REVENUE_PER_UNIT_PER_S));
  // Apply Protocol revenue multiplier (>= 1; no-op at level 0)
  return mul(base, revenueMultiplier(state));
}

// ---------------------------------------------------------------------------
// Congestion update
// ---------------------------------------------------------------------------

/**
 * updateCongestion(state, dtMs) — advance the congestion model by dtMs.
 *
 * Deficit path:
 *   - Accumulate deficitMs (capped at DEFICIT_RAMP_WINDOW_MS).
 *   - Linearly interpolate congestionEfficiency from 1.0 → CONGESTION_FLOOR
 *     as deficitMs advances from 0 → DEFICIT_RAMP_WINDOW_MS.
 *   - Never drops below CONGESTION_FLOOR.
 *
 * Surplus / at-capacity path:
 *   - Reset deficitMs to 0 immediately.
 *   - Recover congestionEfficiency linearly back toward 1.0, symmetric with
 *     the ramp-down speed (same DEFICIT_RAMP_WINDOW_MS window).
 *   - Never exceeds 1.0.
 *
 * Rationale for the recovery design:
 *   - Symmetric ramp means the feel is reversible and predictable.
 *   - Idling (no upgrades) causes Demand to grow past Bandwidth, but the
 *     floor prevents a death spiral on check-in.
 *
 * @param state  Current game state (not mutated).
 * @param dtMs   Milliseconds elapsed this tick (wall-clock delta, owned by tick loop).
 * @param bw     Optional precomputed bandwidth (avoids recomputing within a tick).
 * @returns      New GameState with updated congestionEfficiency and deficitMs.
 */
export function updateCongestion(state: GameState, dtMs: number, bw?: Decimal): GameState {
  const bandwidth = bw ?? computeBandwidth(state);
  const inDeficit = cmp(bandwidth, state.demand) < 0;  // strict less-than: 'deficit' only

  if (inDeficit) {
    // Advance and cap deficitMs
    const newDeficitMs = Math.min(state.deficitMs + dtMs, DEFICIT_RAMP_WINDOW_MS);

    // Linear sag: efficiency = 1.0 - (1 - floor) * (deficitMs / window)
    const sag = (1 - CONGESTION_FLOOR) * (newDeficitMs / DEFICIT_RAMP_WINDOW_MS);
    const newEfficiency = Math.max(1.0 - sag, CONGESTION_FLOOR);

    return {
      ...state,
      deficitMs: newDeficitMs,
      congestionEfficiency: newEfficiency,
    };
  }

  // Surplus or at-capacity: reset deficit timer, recover efficiency
  const recoveryDelta = (1 - CONGESTION_FLOOR) * (dtMs / DEFICIT_RAMP_WINDOW_MS);
  const newEfficiency = Math.min(state.congestionEfficiency + recoveryDelta, 1.0);

  return {
    ...state,
    deficitMs: 0,
    congestionEfficiency: newEfficiency,
  };
}
