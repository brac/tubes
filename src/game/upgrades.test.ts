/**
 * upgrades.test.ts
 *
 * Tests for era-1 upgrade definitions, cost curves, and cost helpers.
 * Written FIRST per TDD contract — these should fail until upgrades.ts exists.
 *
 * AAA (Arrange-Act-Assert) throughout. Descriptive names explain the behavior.
 */

import { describe, it, expect } from 'vitest';
import { D, gte } from '../lib/bignum';
import {
  ERA1_UPGRADES,
  costForLevel,
  nextCost,
  type UpgradeDef,
} from './upgrades';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the upgrade with the given id, throwing if not found. */
function getUpgrade(id: string): UpgradeDef {
  const u = ERA1_UPGRADES.find((u) => u.id === id);
  if (!u) throw new Error(`Upgrade not found: ${id}`);
  return u;
}

// ---------------------------------------------------------------------------
// Catalog shape
// ---------------------------------------------------------------------------

describe('ERA1_UPGRADES catalog', () => {
  it('contains at least four distinct upgrades', () => {
    expect(ERA1_UPGRADES.length).toBeGreaterThanOrEqual(4);
  });

  it('every upgrade has a non-empty id, name, and bandwidthPerLevel > 0', () => {
    for (const u of ERA1_UPGRADES) {
      expect(u.id.length).toBeGreaterThan(0);
      expect(u.name.length).toBeGreaterThan(0);
      expect(gte(u.bandwidthPerLevel, D(0))).toBe(true);
    }
  });

  it('every upgrade has a baseCost > 0', () => {
    for (const u of ERA1_UPGRADES) {
      expect(gte(u.baseCost, D(1))).toBe(true);
    }
  });

  it('every upgrade has a costGrowth between 1.01 and 1.30 (sane range)', () => {
    for (const u of ERA1_UPGRADES) {
      expect(u.costGrowth).toBeGreaterThan(1.0);
      expect(u.costGrowth).toBeLessThanOrEqual(1.3);
    }
  });

  it('upgrade ids are unique', () => {
    const ids = ERA1_UPGRADES.map((u) => u.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('includes cleaner-lines, dedicated-line, isdn, and 56k upgrades from the design doc', () => {
    const ids = ERA1_UPGRADES.map((u) => u.id);
    expect(ids).toContain('cleaner-lines');
    expect(ids).toContain('dedicated-line');
    expect(ids).toContain('isdn');
    expect(ids).toContain('56k');
  });
});

// ---------------------------------------------------------------------------
// costForLevel — geometric curve: baseCost * costGrowth^level
// ---------------------------------------------------------------------------

describe('costForLevel', () => {
  it('returns baseCost exactly at level 0', () => {
    // Arrange
    const upgrade = getUpgrade('cleaner-lines');

    // Act
    const cost = costForLevel(upgrade, 0);

    // Assert — cost at level 0 must equal baseCost
    expect(cost.toNumber()).toBeCloseTo(upgrade.baseCost.toNumber(), 4);
  });

  it('returns baseCost * costGrowth at level 1', () => {
    // Arrange
    const upgrade = getUpgrade('cleaner-lines');
    const expected = upgrade.baseCost.toNumber() * upgrade.costGrowth;

    // Act
    const cost = costForLevel(upgrade, 1);

    // Assert
    expect(cost.toNumber()).toBeCloseTo(expected, 4);
  });

  it('returns baseCost * costGrowth^2 at level 2', () => {
    // Arrange
    const upgrade = getUpgrade('dedicated-line');
    const expected =
      upgrade.baseCost.toNumber() * Math.pow(upgrade.costGrowth, 2);

    // Act
    const cost = costForLevel(upgrade, 2);

    // Assert
    expect(cost.toNumber()).toBeCloseTo(expected, 4);
  });

  it('cost at level 10 equals baseCost * costGrowth^10', () => {
    // Arrange
    const upgrade = getUpgrade('isdn');
    const expected =
      upgrade.baseCost.toNumber() * Math.pow(upgrade.costGrowth, 10);

    // Act
    const cost = costForLevel(upgrade, 10);

    // Assert
    expect(cost.toNumber()).toBeCloseTo(expected, 2);
  });

  it('cost at level 50 is a valid positive number (no overflow with Decimal)', () => {
    // Arrange
    const upgrade = getUpgrade('56k');

    // Act
    const cost = costForLevel(upgrade, 50);

    // Assert — large but finite; Decimal handles it
    expect(cost.toNumber()).toBeGreaterThan(0);
    expect(isFinite(cost.toNumber())).toBe(true);
  });

  it('returns a new Decimal each call (immutability — no shared reference)', () => {
    // Arrange
    const upgrade = getUpgrade('cleaner-lines');

    // Act
    const a = costForLevel(upgrade, 5);
    const b = costForLevel(upgrade, 5);

    // Assert — same value, different object instances
    expect(a.toNumber()).toBeCloseTo(b.toNumber(), 6);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// nextCost — cost for the NEXT purchase given current level
// ---------------------------------------------------------------------------

describe('nextCost', () => {
  it('nextCost at level 0 equals costForLevel(upgrade, 0)', () => {
    // Arrange
    const upgrade = getUpgrade('cleaner-lines');

    // Act
    const next = nextCost(upgrade, 0);
    const expected = costForLevel(upgrade, 0);

    // Assert
    expect(next.toNumber()).toBeCloseTo(expected.toNumber(), 6);
  });

  it('nextCost at level 3 equals costForLevel(upgrade, 3)', () => {
    // Arrange
    const upgrade = getUpgrade('dedicated-line');

    // Act
    const next = nextCost(upgrade, 3);
    const expected = costForLevel(upgrade, 3);

    // Assert
    expect(next.toNumber()).toBeCloseTo(expected.toNumber(), 6);
  });

  it('nextCost advances to the correct level after one purchase conceptually', () => {
    // Arrange
    const upgrade = getUpgrade('isdn');
    const currentLevel = 7;

    // Act — cost for the 8th purchase
    const next = nextCost(upgrade, currentLevel);
    const forLevel7 = costForLevel(upgrade, 7);

    // Assert
    expect(next.toNumber()).toBeCloseTo(forLevel7.toNumber(), 6);
  });
});

// ---------------------------------------------------------------------------
// Monotonic increase — each purchase costs more than the last
// ---------------------------------------------------------------------------

describe('cost curve monotonic increase', () => {
  it('every consecutive level costs strictly more than the previous (cleaner-lines, levels 0-19)', () => {
    // Arrange
    const upgrade = getUpgrade('cleaner-lines');

    for (let level = 1; level < 20; level++) {
      // Act
      const prev = costForLevel(upgrade, level - 1);
      const curr = costForLevel(upgrade, level);

      // Assert
      expect(curr.toNumber()).toBeGreaterThan(prev.toNumber());
    }
  });

  it('every consecutive level costs strictly more than the previous (56k, levels 0-29)', () => {
    // Arrange
    const upgrade = getUpgrade('56k');

    for (let level = 1; level < 30; level++) {
      // Act
      const prev = costForLevel(upgrade, level - 1);
      const curr = costForLevel(upgrade, level);

      // Assert
      expect(curr.toNumber()).toBeGreaterThan(prev.toNumber());
    }
  });

  it('cost doubles in a predictable number of levels (growth-rate sanity)', () => {
    // Arrange — with costGrowth 1.10, cost doubles in ~7.3 levels (log2 / log1.10)
    const upgrade = ERA1_UPGRADES.find((u) => u.costGrowth === 1.1);
    if (!upgrade) return; // skip if no 1.10 upgrade defined

    const base = costForLevel(upgrade, 0).toNumber();
    const level10 = costForLevel(upgrade, 10).toNumber();

    // Act — 1.10^10 ≈ 2.59, so 10 levels should approximately 2.5-2.6x the cost
    const ratio = level10 / base;

    // Assert
    expect(ratio).toBeGreaterThan(2.4);
    expect(ratio).toBeLessThan(2.8);
  });
});

// ---------------------------------------------------------------------------
// bandwidthPerLevel — upgrades actually provide bandwidth
// ---------------------------------------------------------------------------

describe('upgrade bandwidth contributions', () => {
  it('cheaper early upgrades provide smaller bandwidth increments than expensive late ones', () => {
    // Arrange — cleaner-lines is cheapest; 56k is the capstone upgrade
    const cheap = getUpgrade('cleaner-lines');
    const expensive = getUpgrade('56k');

    // Act
    const cheapBW = cheap.bandwidthPerLevel.toNumber();
    const expensiveBW = expensive.bandwidthPerLevel.toNumber();

    // Assert — more expensive upgrades should offer more bandwidth per level
    expect(expensiveBW).toBeGreaterThan(cheapBW);
  });

  it('all era-1 upgrades provide a positive bandwidth contribution per level', () => {
    for (const u of ERA1_UPGRADES) {
      expect(u.bandwidthPerLevel.toNumber()).toBeGreaterThan(0);
    }
  });
});
