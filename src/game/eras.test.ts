/**
 * eras.test.ts
 *
 * Tests for eras.ts — era table, helpers, and Phase-3 additions.
 *
 * Written FIRST (TDD). Tests describe the expected contract and fail until
 * the implementation is updated.
 */

import { describe, it, expect } from 'vitest';
import {
  ERA_TABLE,
  getEra,
  hasNextEra,
  getNextEra,
} from './eras';

// ---------------------------------------------------------------------------
// ERA_TABLE shape
// ---------------------------------------------------------------------------

describe('ERA_TABLE', () => {
  it('contains at least two eras (era 1 Dial-up and era 2 Broadband)', () => {
    expect(ERA_TABLE.length).toBeGreaterThanOrEqual(2);
  });

  it('era 1 is Dial-up', () => {
    const era1 = ERA_TABLE[0]!;
    expect(era1.id).toBe(1);
    expect(era1.name).toBe('Dial-up');
  });

  it('era 2 is Broadband', () => {
    const era2 = ERA_TABLE.find((e) => e.id === 2);
    expect(era2).toBeDefined();
    expect(era2!.name).toBe('Broadband');
  });

  it('era 2 has a baseDemand well above era 1', () => {
    const era1 = getEra(1);
    const era2 = getEra(2);
    // Era 2 demand should be significantly higher — at least 5× era 1 base
    expect(era2.baseDemand.toNumber()).toBeGreaterThan(era1.baseDemand.toNumber() * 5);
  });

  it('era 2 has a contentDriver string describing early-web content', () => {
    const era2 = getEra(2);
    expect(era2.contentDriver).toBeTruthy();
    expect(typeof era2.contentDriver).toBe('string');
  });

  it('era 2 has a paletteKey string', () => {
    const era2 = getEra(2);
    expect(era2.paletteKey).toBeTruthy();
    expect(typeof era2.paletteKey).toBe('string');
  });

  it('era 2 has a nextEraDemandMultiplier >= 1 (placeholder for era 3)', () => {
    const era2 = getEra(2);
    expect(era2.nextEraDemandMultiplier).toBeGreaterThanOrEqual(1);
  });

  it('era 1 nextEraDemandMultiplier is approximately 10 (drives era 1->2 jump)', () => {
    const era1 = getEra(1);
    // Should be around 10 per design doc (5–20x range)
    expect(era1.nextEraDemandMultiplier).toBeGreaterThanOrEqual(5);
    expect(era1.nextEraDemandMultiplier).toBeLessThanOrEqual(20);
  });

  it('era IDs are unique', () => {
    const ids = ERA_TABLE.map((e) => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('era table is sorted by id ascending', () => {
    for (let i = 1; i < ERA_TABLE.length; i++) {
      expect(ERA_TABLE[i]!.id).toBeGreaterThan(ERA_TABLE[i - 1]!.id);
    }
  });
});

// ---------------------------------------------------------------------------
// getEra
// ---------------------------------------------------------------------------

describe('getEra', () => {
  it('returns the correct era for a valid id', () => {
    const era1 = getEra(1);
    expect(era1.id).toBe(1);
    expect(era1.name).toBe('Dial-up');
  });

  it('returns era 2 correctly', () => {
    const era2 = getEra(2);
    expect(era2.id).toBe(2);
    expect(era2.name).toBe('Broadband');
  });

  it('throws for an unknown era id', () => {
    expect(() => getEra(999)).toThrow(/Era 999/);
  });
});

// ---------------------------------------------------------------------------
// hasNextEra
// ---------------------------------------------------------------------------

describe('hasNextEra', () => {
  it('returns true for era 1 (era 2 exists)', () => {
    expect(hasNextEra(1)).toBe(true);
  });

  it('returns false for the last era in the table', () => {
    const lastEraId = ERA_TABLE[ERA_TABLE.length - 1]!.id;
    expect(hasNextEra(lastEraId)).toBe(false);
  });

  it('returns false for an era id beyond the table', () => {
    expect(hasNextEra(999)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getNextEra
// ---------------------------------------------------------------------------

describe('getNextEra', () => {
  it('returns era 2 when called with era 1', () => {
    const next = getNextEra(1);
    expect(next).not.toBeNull();
    expect(next!.id).toBe(2);
    expect(next!.name).toBe('Broadband');
  });

  it('returns null for the last era in the table', () => {
    const lastEraId = ERA_TABLE[ERA_TABLE.length - 1]!.id;
    expect(getNextEra(lastEraId)).toBeNull();
  });

  it('returns null for an unknown era id', () => {
    expect(getNextEra(999)).toBeNull();
  });
});
