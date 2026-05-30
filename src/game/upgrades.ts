/**
 * upgrades.ts
 *
 * Era-1 (Dial-up) upgrade definitions and cost helpers.
 *
 * Upgrades follow geometric cost scaling: the N-th purchase of an upgrade
 * costs   baseCost × costGrowth^N   (level is 0-indexed, so level 0 = first
 * purchase at baseCost, level 1 = second purchase at baseCost × costGrowth, …).
 *
 * Design intent (from docs/tubes-game-design.md §4):
 *   "Within each era: many small, cheap, frequent upgrades (the dopamine drip)."
 * So era 1 has several tiers — cheap+low-bandwidth to expensive+high-bandwidth —
 * so the player always has something affordable to click.
 */

import { D, mul, pow } from '../lib/bignum';
import type { Decimal } from '../lib/bignum';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpgradeDef {
  /** Unique string identifier. Used as the key in GameState.upgradeLevels. */
  id: string;

  /** Human-readable name shown in the UI. */
  name: string;

  /** Cost of level 0 (first purchase). All subsequent levels scale from this. */
  baseCost: Decimal;

  /**
   * Per-level cost multiplier. Each purchase increases the next cost by this
   * factor. Recommended range 1.07–1.15 (design doc §8).
   */
  costGrowth: number;

  /**
   * Bandwidth (bps) added to the player's total per level owned.
   * computeBandwidth in economy.ts sums   level × bandwidthPerLevel   for all
   * upgrades and adds STARTING_BANDWIDTH to get the total.
   */
  bandwidthPerLevel: Decimal;
}

// ---------------------------------------------------------------------------
// Era-1 upgrade catalog
// ---------------------------------------------------------------------------

/**
 * ERA1_UPGRADES — all purchasable upgrades available in the Dial-up era.
 *
 * Ordered cheapest → most expensive so the UI can display them naturally.
 * Names and flavor follow the design doc era-1 upgrade list.
 *
 * Bandwidth values are calibrated so buying a handful of cheap upgrades
 * visibly moves the needle without immediately overwhelming demand, while
 * the capstone (56k modem) provides a meaningful leap.
 */
export const ERA1_UPGRADES: readonly UpgradeDef[] = [
  {
    // Cheapest, most frequent — the "dopamine drip" starting point.
    id: 'cleaner-lines',
    name: 'Cleaner Lines',
    baseCost: D(10),
    costGrowth: 1.07,
    bandwidthPerLevel: D(5),
  },
  {
    // Mid-tier: meaningful bandwidth jump, moderate cost ramp.
    id: 'dedicated-line',
    name: 'Dedicated Line',
    baseCost: D(75),
    costGrowth: 1.09,
    bandwidthPerLevel: D(20),
  },
  {
    // ISDN: higher per-level bandwidth, steeper cost growth.
    id: 'isdn',
    name: 'ISDN',
    baseCost: D(400),
    costGrowth: 1.1,
    bandwidthPerLevel: D(64),
  },
  {
    // 56k: era-1 capstone — the "modem ceiling" before broadband.
    // Most expensive, biggest single-level bandwidth contribution.
    id: '56k',
    name: '56k Modem',
    baseCost: D(2_000),
    costGrowth: 1.12,
    bandwidthPerLevel: D(200),
  },
];

// ---------------------------------------------------------------------------
// Cost helpers
// ---------------------------------------------------------------------------

/**
 * costForLevel(upgrade, level) — cost to purchase the upgrade at the given
 * level (0-indexed: level 0 = first purchase, level 1 = second, …).
 *
 * Formula: baseCost × costGrowth^level
 *
 * Returns a new Decimal each call (immutability contract).
 */
export function costForLevel(upgrade: UpgradeDef, level: number): Decimal {
  // costGrowth is a plain JS number; pow() expects Decimal exponent
  return mul(upgrade.baseCost, pow(D(upgrade.costGrowth), D(level)));
}

/**
 * nextCost(upgrade, currentLevel) — cost of the NEXT purchase given how
 * many levels the player already owns.
 *
 * If the player owns `currentLevel` levels, the next purchase costs
 * costForLevel(upgrade, currentLevel).
 *
 * This is a thin semantic wrapper; callers should use this rather than
 * calling costForLevel directly so intent is clear at the call site.
 */
export function nextCost(upgrade: UpgradeDef, currentLevel: number): Decimal {
  return costForLevel(upgrade, currentLevel);
}
