/**
 * protocol.test.ts
 *
 * TDD tests for the Protocol tree — written FIRST before implementation.
 *
 * Coverage:
 *   - PROTOCOL_NODES catalog shape validation
 *   - costForProtocolLevel geometric scaling
 *   - Each multiplier at level 0 (identity) and multiple levels
 *   - upgradeCostMultiplier floor enforcement
 *   - buyProtocol happy path (spends protocol, increments level)
 *   - buyProtocol no-op when unaffordable
 *   - buyProtocol no-op when unknown node id
 */

import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_NODES,
  costForProtocolLevel,
  revenueMultiplier,
  bandwidthMultiplier,
  upgradeCostMultiplier,
  offlineMultiplier,
  buyProtocol,
  UPGRADE_COST_MULTIPLIER_FLOOR,
} from './protocol';
import { D, ZERO, ONE, gte, lte, gt } from '../lib/bignum';
import { initialState } from './state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a state with given protocol amount and levels. */
function stateWith(
  protocolAmount: number,
  levels: Record<string, number> = {},
) {
  const s = initialState(0);
  return {
    ...s,
    protocol: D(protocolAmount),
    protocolLevels: { ...levels },
  };
}

// ---------------------------------------------------------------------------
// PROTOCOL_NODES catalog shape
// ---------------------------------------------------------------------------

describe('PROTOCOL_NODES catalog', () => {
  it('exports a non-empty array', () => {
    expect(Array.isArray(PROTOCOL_NODES)).toBe(true);
    expect(PROTOCOL_NODES.length).toBeGreaterThanOrEqual(4);
  });

  it('every node has id, name, description, baseCost, costGrowth', () => {
    for (const node of PROTOCOL_NODES) {
      expect(typeof node.id).toBe('string');
      expect(node.id.length).toBeGreaterThan(0);
      expect(typeof node.name).toBe('string');
      expect(node.name.length).toBeGreaterThan(0);
      expect(typeof node.description).toBe('string');
      expect(node.description.length).toBeGreaterThan(0);
      // baseCost is a Decimal — check it is > 0
      expect(gt(node.baseCost, ZERO)).toBe(true);
      expect(typeof node.costGrowth).toBe('number');
      expect(node.costGrowth).toBeGreaterThan(1);
    }
  });

  it('all node ids are unique', () => {
    const ids = PROTOCOL_NODES.map((n) => n.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('contains exactly the expected canonical node ids', () => {
    const ids = PROTOCOL_NODES.map((n) => n.id);
    expect(ids).toContain('revenue-boost');
    expect(ids).toContain('bandwidth-boost');
    expect(ids).toContain('upgrade-discount');
    expect(ids).toContain('offline-boost');
  });
});

// ---------------------------------------------------------------------------
// costForProtocolLevel — geometric scaling
// ---------------------------------------------------------------------------

describe('costForProtocolLevel', () => {
  it('level 0 returns baseCost exactly', () => {
    const node = PROTOCOL_NODES[0]!;
    const cost = costForProtocolLevel(node, 0);
    expect(cost.toNumber()).toBeCloseTo(node.baseCost.toNumber(), 6);
  });

  it('level 1 returns baseCost × costGrowth', () => {
    const node = PROTOCOL_NODES[0]!;
    const cost = costForProtocolLevel(node, 1);
    const expected = node.baseCost.toNumber() * node.costGrowth;
    expect(cost.toNumber()).toBeCloseTo(expected, 4);
  });

  it('level 3 returns baseCost × costGrowth^3', () => {
    const node = PROTOCOL_NODES[0]!;
    const cost = costForProtocolLevel(node, 3);
    const expected = node.baseCost.toNumber() * Math.pow(node.costGrowth, 3);
    expect(cost.toNumber()).toBeCloseTo(expected, 4);
  });

  it('cost is always strictly increasing with level', () => {
    const node = PROTOCOL_NODES[0]!;
    const c0 = costForProtocolLevel(node, 0).toNumber();
    const c1 = costForProtocolLevel(node, 1).toNumber();
    const c2 = costForProtocolLevel(node, 2).toNumber();
    expect(c1).toBeGreaterThan(c0);
    expect(c2).toBeGreaterThan(c1);
  });

  it('works for all nodes in the catalog', () => {
    for (const node of PROTOCOL_NODES) {
      const c0 = costForProtocolLevel(node, 0).toNumber();
      const c1 = costForProtocolLevel(node, 1).toNumber();
      expect(c1).toBeCloseTo(c0 * node.costGrowth, 4);
    }
  });
});

// ---------------------------------------------------------------------------
// revenueMultiplier — level 0 = identity (1), grows with levels
// ---------------------------------------------------------------------------

describe('revenueMultiplier', () => {
  it('returns exactly 1 when revenue-boost is level 0 (missing)', () => {
    const s = stateWith(0, {});
    expect(revenueMultiplier(s).toNumber()).toBeCloseTo(1, 9);
  });

  it('returns > 1 when revenue-boost is level 1', () => {
    const s = stateWith(0, { 'revenue-boost': 1 });
    expect(revenueMultiplier(s).toNumber()).toBeGreaterThan(1);
  });

  it('is strictly increasing with level', () => {
    const s1 = stateWith(0, { 'revenue-boost': 1 });
    const s2 = stateWith(0, { 'revenue-boost': 2 });
    const s5 = stateWith(0, { 'revenue-boost': 5 });
    const m1 = revenueMultiplier(s1).toNumber();
    const m2 = revenueMultiplier(s2).toNumber();
    const m5 = revenueMultiplier(s5).toNumber();
    expect(m2).toBeGreaterThan(m1);
    expect(m5).toBeGreaterThan(m2);
  });

  it('is always >= 1 regardless of level', () => {
    for (const lvl of [0, 1, 3, 10]) {
      const s = stateWith(0, { 'revenue-boost': lvl });
      expect(gte(revenueMultiplier(s), ONE)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// bandwidthMultiplier — level 0 = 1, grows with levels
// ---------------------------------------------------------------------------

describe('bandwidthMultiplier', () => {
  it('returns exactly 1 when bandwidth-boost is level 0', () => {
    const s = stateWith(0, {});
    expect(bandwidthMultiplier(s).toNumber()).toBeCloseTo(1, 9);
  });

  it('returns > 1 when bandwidth-boost is level 1', () => {
    const s = stateWith(0, { 'bandwidth-boost': 1 });
    expect(bandwidthMultiplier(s).toNumber()).toBeGreaterThan(1);
  });

  it('is strictly increasing with level', () => {
    const s1 = stateWith(0, { 'bandwidth-boost': 1 });
    const s3 = stateWith(0, { 'bandwidth-boost': 3 });
    expect(bandwidthMultiplier(s3).toNumber()).toBeGreaterThan(
      bandwidthMultiplier(s1).toNumber(),
    );
  });

  it('is always >= 1', () => {
    for (const lvl of [0, 2, 7]) {
      const s = stateWith(0, { 'bandwidth-boost': lvl });
      expect(gte(bandwidthMultiplier(s), ONE)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// upgradeCostMultiplier — level 0 = 1, decreases toward floor
// ---------------------------------------------------------------------------

describe('upgradeCostMultiplier', () => {
  it('returns exactly 1 when upgrade-discount is level 0', () => {
    const s = stateWith(0, {});
    expect(upgradeCostMultiplier(s).toNumber()).toBeCloseTo(1, 9);
  });

  it('returns < 1 when upgrade-discount is level 1', () => {
    const s = stateWith(0, { 'upgrade-discount': 1 });
    expect(upgradeCostMultiplier(s).toNumber()).toBeLessThan(1);
  });

  it('is strictly decreasing with level (more discount)', () => {
    const s1 = stateWith(0, { 'upgrade-discount': 1 });
    const s3 = stateWith(0, { 'upgrade-discount': 3 });
    expect(upgradeCostMultiplier(s3).toNumber()).toBeLessThan(
      upgradeCostMultiplier(s1).toNumber(),
    );
  });

  it('never goes below the exported floor constant', () => {
    const s = stateWith(0, { 'upgrade-discount': 1000 });
    const m = upgradeCostMultiplier(s).toNumber();
    expect(m).toBeGreaterThanOrEqual(UPGRADE_COST_MULTIPLIER_FLOOR);
  });

  it('is always <= 1', () => {
    for (const lvl of [0, 1, 5, 50]) {
      const s = stateWith(0, { 'upgrade-discount': lvl });
      expect(lte(upgradeCostMultiplier(s), ONE)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// offlineMultiplier — level 0 = 1, grows with levels
// ---------------------------------------------------------------------------

describe('offlineMultiplier', () => {
  it('returns exactly 1 when offline-boost is level 0', () => {
    const s = stateWith(0, {});
    expect(offlineMultiplier(s).toNumber()).toBeCloseTo(1, 9);
  });

  it('returns > 1 when offline-boost is level 1', () => {
    const s = stateWith(0, { 'offline-boost': 1 });
    expect(offlineMultiplier(s).toNumber()).toBeGreaterThan(1);
  });

  it('is strictly increasing with level', () => {
    const s2 = stateWith(0, { 'offline-boost': 2 });
    const s5 = stateWith(0, { 'offline-boost': 5 });
    expect(offlineMultiplier(s5).toNumber()).toBeGreaterThan(
      offlineMultiplier(s2).toNumber(),
    );
  });

  it('is always >= 1', () => {
    for (const lvl of [0, 3, 10]) {
      const s = stateWith(0, { 'offline-boost': lvl });
      expect(gte(offlineMultiplier(s), ONE)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// buyProtocol — happy path
// ---------------------------------------------------------------------------

describe('buyProtocol happy path', () => {
  it('spends protocol equal to costForProtocolLevel(node, currentLevel)', () => {
    const node = PROTOCOL_NODES.find((n) => n.id === 'revenue-boost')!;
    const cost = costForProtocolLevel(node, 0);
    // Give the player enough protocol to afford it
    const s = stateWith(cost.toNumber() + 100);
    const s2 = buyProtocol(s, 'revenue-boost');

    const expectedProtocol = s.protocol.toNumber() - cost.toNumber();
    expect(s2.protocol.toNumber()).toBeCloseTo(expectedProtocol, 4);
  });

  it('increments protocolLevels[nodeId] from 0 to 1', () => {
    const node = PROTOCOL_NODES.find((n) => n.id === 'revenue-boost')!;
    const cost = costForProtocolLevel(node, 0);
    const s = stateWith(cost.toNumber() + 100);
    const s2 = buyProtocol(s, 'revenue-boost');
    expect(s2.protocolLevels['revenue-boost']).toBe(1);
  });

  it('increments protocolLevels from 2 to 3 (subsequent purchase)', () => {
    const node = PROTOCOL_NODES.find((n) => n.id === 'bandwidth-boost')!;
    const level2Cost = costForProtocolLevel(node, 2);
    const s = stateWith(level2Cost.toNumber() + 50, { 'bandwidth-boost': 2 });
    const s2 = buyProtocol(s, 'bandwidth-boost');
    expect(s2.protocolLevels['bandwidth-boost']).toBe(3);
  });

  it('returns a new state object (immutability)', () => {
    const node = PROTOCOL_NODES.find((n) => n.id === 'revenue-boost')!;
    const cost = costForProtocolLevel(node, 0);
    const s = stateWith(cost.toNumber() + 1);
    const s2 = buyProtocol(s, 'revenue-boost');
    expect(s2).not.toBe(s);
  });

  it('does not modify protocolLevels of unrelated nodes', () => {
    const node = PROTOCOL_NODES.find((n) => n.id === 'revenue-boost')!;
    const cost = costForProtocolLevel(node, 0);
    const s = stateWith(cost.toNumber() + 100, { 'bandwidth-boost': 3 });
    const s2 = buyProtocol(s, 'revenue-boost');
    expect(s2.protocolLevels['bandwidth-boost']).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// buyProtocol — no-op when unaffordable
// ---------------------------------------------------------------------------

describe('buyProtocol when unaffordable', () => {
  it('returns the SAME reference when protocol is 0 and node costs > 0', () => {
    const s = stateWith(0);
    const s2 = buyProtocol(s, 'revenue-boost');
    expect(s2).toBe(s);
  });

  it('returns same ref when protocol is insufficient by 1 unit', () => {
    const node = PROTOCOL_NODES.find((n) => n.id === 'revenue-boost')!;
    const cost = costForProtocolLevel(node, 0);
    // Give 1 less than the cost
    const s = stateWith(cost.toNumber() - 1);
    const s2 = buyProtocol(s, 'revenue-boost');
    expect(s2).toBe(s);
  });

  it('does not change protocol balance on unaffordable', () => {
    const s = stateWith(0);
    const s2 = buyProtocol(s, 'bandwidth-boost');
    expect(s2.protocol.toNumber()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buyProtocol — no-op when unknown nodeId
// ---------------------------------------------------------------------------

describe('buyProtocol with unknown nodeId', () => {
  it('returns the SAME reference for an unknown node', () => {
    const s = stateWith(9999);
    const s2 = buyProtocol(s, 'nonexistent-node');
    expect(s2).toBe(s);
  });

  it('does not alter protocol balance for unknown node', () => {
    const s = stateWith(9999);
    const s2 = buyProtocol(s, 'completely-fake');
    expect(s2.protocol.toNumber()).toBe(9999);
  });
});
