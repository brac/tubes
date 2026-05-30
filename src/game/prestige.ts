/**
 * prestige.ts
 *
 * "Rebuild the Backbone" — the repeatable prestige reset loop.
 *
 * Pure, immutable reducers. No wall-clock reads, no RNG.
 *
 * Contract:
 *   canPrestige(state)  — guard: true only if the run peak clears the minimum.
 *   protocolGain(state) — sub-linear Protocol payout; ZERO if below threshold.
 *   prestige(state)     — full immutable reset; no-op (same ref) if not eligible.
 *
 * CRITICAL INVARIANT: eras NEVER regress. prestige() preserves state.era and
 * state.protocolLevels unconditionally. Never call getNextEra or modify era here.
 */

import { D, ZERO, add, gte } from '../lib/bignum';
import type { Decimal } from '../lib/bignum';
import type { GameState } from './state';
import {
  PRESTIGE_MIN_PEAK_RATE,
  PROTOCOL_GAIN_DIVISOR,
  PROTOCOL_GAIN_K,
} from './config';
import { getEra } from './eras';

// ---------------------------------------------------------------------------
// canPrestige
// ---------------------------------------------------------------------------

/**
 * Returns true only when the run's peak Revenue rate has cleared the minimum
 * threshold, making "Rebuild the Backbone" available to the player.
 *
 * Prevents spam-prestiging at zero progress.
 */
export function canPrestige(state: GameState): boolean {
  return gte(state.runPeakRevenueRate, D(PRESTIGE_MIN_PEAK_RATE));
}

// ---------------------------------------------------------------------------
// protocolGain
// ---------------------------------------------------------------------------

/**
 * Computes the Protocol payout for the current run.
 *
 * Formula:  floor( PROTOCOL_GAIN_K × sqrt( runPeakRevenueRate / PROTOCOL_GAIN_DIVISOR ) )
 *
 * Sub-linear by design: doubling the peak does NOT double the gain.
 * Floored to a whole number so the Protocol currency is always an integer.
 *
 * Returns ZERO when below the minimum threshold (canPrestige is false).
 */
export function protocolGain(state: GameState): Decimal {
  if (!canPrestige(state)) return ZERO;

  const peakNumber = state.runPeakRevenueRate.toNumber();
  const raw = PROTOCOL_GAIN_K * Math.sqrt(peakNumber / PROTOCOL_GAIN_DIVISOR);
  const floored = Math.floor(raw);

  return D(floored);
}

// ---------------------------------------------------------------------------
// prestige
// ---------------------------------------------------------------------------

/**
 * "Rebuild the Backbone" — immutable prestige reducer.
 *
 * What RESETS (within-run buildout):
 *   - revenue            → ZERO
 *   - upgradeLevels      → {}
 *   - congestionEfficiency → 1.0
 *   - deficitMs          → 0
 *   - demand             → current era's baseDemand (era baseline)
 *   - eraGateMs          → 0
 *   - runPeakRevenueRate → ZERO
 *
 * What is ADDED:
 *   - protocol           → old protocol + protocolGain(state)
 *
 * What is PRESERVED (permanent progress, NEVER lost):
 *   - era                (ERAS NEVER REGRESS — critical invariant)
 *   - protocolLevels     (permanent tree investments)
 *   - elapsedMs          (simulation clock keeps running)
 *   - lastSaveAt         (persistence metadata)
 *
 * Returns the SAME state reference unchanged if canPrestige(state) is false.
 */
export function prestige(state: GameState): GameState {
  if (!canPrestige(state)) return state;

  const gain = protocolGain(state);
  const eraDef = getEra(state.era);

  return {
    // ----- preserved permanent fields -----
    era: state.era,                        // NEVER regresses
    protocolLevels: state.protocolLevels,  // tree investments survive
    elapsedMs: state.elapsedMs,            // simulation clock continues
    lastSaveAt: state.lastSaveAt,          // persistence metadata unchanged

    // ----- protocol gains -----
    protocol: add(state.protocol, gain),

    // ----- reset within-run buildout -----
    revenue: ZERO,
    upgradeLevels: {},
    congestionEfficiency: 1.0,
    deficitMs: 0,
    demand: eraDef.baseDemand,
    eraGateMs: 0,
    runPeakRevenueRate: ZERO,
  };
}
