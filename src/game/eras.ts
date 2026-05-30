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
    // A ~10× jump when entering Broadband; will be tuned in Phase 3.
    nextEraDemandMultiplier: 10,
  },
  // Era 2 (Broadband), Era 3 (Streaming), etc. go here in later phases.
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
