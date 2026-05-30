/**
 * eras.ts
 *
 * Era data table. Each era is a permanent forward step in the game — eras
 * never regress on prestige. New eras append cleanly to ERA_TABLE.
 *
 * Phase 1 contains only era 1 (Dial-up). Subsequent phases add eras 2+.
 */

import { D } from '../lib/bignum';
import type { Decimal } from '../lib/bignum';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EraDef {
  /** Numeric id, 1-indexed. Used as GameState.era. */
  id: number;

  /** Display name shown in the UI. */
  name: string;

  /**
   * The content type driving demand in this era — describes the flavor of
   * internet traffic (for UI tooltips and lore, not game mechanics).
   */
  contentDriver: string;

  /**
   * CSS palette key: maps to a visual theme in the renderer (Phase 5+).
   * Kept here so eras.ts is the single source of truth for era identity.
   */
  paletteKey: string;

  /**
   * Base demand at the start of this era (bps).
   * The tick loop initialises demand to this value on era entry.
   * For era 1 this matches STARTING_DEMAND in config.ts.
   */
  baseDemand: Decimal;

  /**
   * Demand step-jump multiplier applied when entering the NEXT era.
   * e.g. 10 means Demand × 10 the moment era N+1 begins.
   * Used by the era-gate logic in Phase 3.
   * Era 1's value is indicative; the exact number will be tuned.
   */
  nextEraDemandMultiplier: number;
}

// ---------------------------------------------------------------------------
// Era table
// ---------------------------------------------------------------------------

/**
 * ERA_TABLE — canonical ordered list of all eras.
 *
 * Append new entries here as later phases add eras.
 * Do NOT change existing era ids — saved games reference them by number.
 */
export const ERA_TABLE: readonly EraDef[] = [
  {
    id: 1,
    name: 'Dial-up',
    contentDriver: 'Text, email',
    paletteKey: 'dialup',
    baseDemand: D(50),
    // ~10× jump when entering Broadband — player must build up significantly
    // before the era gate and then faces an immediate 10× demand shock.
    nextEraDemandMultiplier: 10,
  },
  {
    id: 2,
    name: 'Broadband',
    contentDriver: 'Images, early web',
    paletteKey: 'broadband',
    // Era 2 starts at 500 bps — the 10× era-1 nextEraDemandMultiplier
    // applied to era-1 baseDemand (50) lands here after the step-jump.
    // Calibrated so the player begins era 2 in a clear deficit and must
    // build DSL / cable-era upgrades to catch up.
    baseDemand: D(500),
    // Placeholder for the era 2 → 3 (Streaming) jump; will be tuned in
    // Phase 7 when era 3 ships. Set to 10 as a sensible default.
    nextEraDemandMultiplier: 10,
  },
  // Era 3 (Streaming), Era 4 (HD/4K), etc. go here in later phases.
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the EraDef for the given era id, or throws if not found.
 * Prefer this over direct index access so the throw message is useful.
 */
export function getEra(id: number): EraDef {
  const era = ERA_TABLE.find((e) => e.id === id);
  if (!era) {
    throw new Error(`Era ${id} not found in ERA_TABLE`);
  }
  return era;
}

/**
 * Returns true when there is a next era after the given era id.
 * Returns false for the last era in ERA_TABLE or for unknown ids.
 *
 * Used by tick.ts to gate the era-advance check without throwing.
 */
export function hasNextEra(eraId: number): boolean {
  const idx = ERA_TABLE.findIndex((e) => e.id === eraId);
  if (idx === -1) return false;
  return idx < ERA_TABLE.length - 1;
}

/**
 * Returns the next EraDef after the given era id, or null if there is none.
 *
 * Callers should prefer this over hasNextEra + getEra(id + 1) because era
 * ids are not guaranteed to be contiguous once post-game procedural eras
 * are introduced.
 */
export function getNextEra(eraId: number): EraDef | null {
  const idx = ERA_TABLE.findIndex((e) => e.id === eraId);
  if (idx === -1 || idx >= ERA_TABLE.length - 1) return null;
  return ERA_TABLE[idx + 1] ?? null;
}
