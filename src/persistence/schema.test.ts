/**
 * schema.test.ts
 *
 * Tests for schema.ts — versioned save shape, serialize/deserialize round-trip,
 * Decimal losslessness, and the migrate() defensive validator.
 *
 * Written FIRST (TDD) before any implementation exists.
 */

import { describe, it, expect } from 'vitest';
import { D, ZERO } from '../lib/bignum';
import { initialState } from '../game/state';
import {
  SAVE_VERSION,
  serialize,
  deserialize,
  migrate,
} from './schema';
import type { SaveData } from './schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a representative GameState with non-trivial values for round-trip tests. */
function makeState() {
  const base = initialState(1_700_000_000_000);
  return {
    ...base,
    revenue: D('12345.678'),
    demand: D('99999'),
    era: 2,
    upgradeLevels: { 'cleaner-lines': 3, 'dedicated-line': 1 },
    congestionEfficiency: 0.85,
    deficitMs: 5000,
    elapsedMs: 120_000,
    lastSaveAt: 1_700_000_000_000,
    protocol: D('42'),
    protocolLevels: { 'revenue-boost': 2 },
    runPeakRevenueRate: D('500'),
    eraGateMs: 15_000,
  };
}

// ---------------------------------------------------------------------------
// serialize / deserialize round-trip
// ---------------------------------------------------------------------------

describe('serialize', () => {
  it('returns a plain JSON-safe object', () => {
    const state = makeState();
    const save = serialize(state);
    // Must survive JSON round-trip without change
    const jsonRound = JSON.parse(JSON.stringify(save)) as SaveData;
    expect(jsonRound).toEqual(save);
  });

  it('stamps version = SAVE_VERSION', () => {
    const save = serialize(makeState());
    expect(save.version).toBe(SAVE_VERSION);
  });

  it('converts Decimal fields to strings', () => {
    const state = makeState();
    const save = serialize(state);
    expect(typeof save.revenue).toBe('string');
    expect(typeof save.demand).toBe('string');
    expect(typeof save.protocol).toBe('string');
    expect(typeof save.runPeakRevenueRate).toBe('string');
  });

  it('preserves number fields as numbers', () => {
    const state = makeState();
    const save = serialize(state);
    expect(typeof save.era).toBe('number');
    expect(typeof save.congestionEfficiency).toBe('number');
    expect(typeof save.deficitMs).toBe('number');
    expect(typeof save.elapsedMs).toBe('number');
    expect(typeof save.lastSaveAt).toBe('number');
    expect(typeof save.eraGateMs).toBe('number');
  });

  it('preserves Record fields as objects', () => {
    const state = makeState();
    const save = serialize(state);
    expect(save.upgradeLevels).toEqual({ 'cleaner-lines': 3, 'dedicated-line': 1 });
    expect(save.protocolLevels).toEqual({ 'revenue-boost': 2 });
  });

  it('does NOT stamp lastSaveAt (clock ownership belongs to the store)', () => {
    // serialize must pass through whatever lastSaveAt is in the state,
    // not replace it with Date.now() internally.
    const frozenAt = 9_999_999_999_999;
    const state = { ...makeState(), lastSaveAt: frozenAt };
    const save = serialize(state);
    expect(save.lastSaveAt).toBe(frozenAt);
  });
});

describe('deserialize', () => {
  it('reconstructs Decimal fields from strings', () => {
    const state = makeState();
    const save = serialize(state);
    const restored = deserialize(save);
    // Decimal values must be live Decimal instances
    expect(restored.revenue.toString()).toBe(state.revenue.toString());
    expect(restored.demand.toString()).toBe(state.demand.toString());
    expect(restored.protocol.toString()).toBe(state.protocol.toString());
    expect(restored.runPeakRevenueRate.toString()).toBe(
      state.runPeakRevenueRate.toString(),
    );
  });

  it('round-trips all number and record fields verbatim', () => {
    const state = makeState();
    const restored = deserialize(serialize(state));
    expect(restored.era).toBe(state.era);
    expect(restored.congestionEfficiency).toBe(state.congestionEfficiency);
    expect(restored.deficitMs).toBe(state.deficitMs);
    expect(restored.elapsedMs).toBe(state.elapsedMs);
    expect(restored.lastSaveAt).toBe(state.lastSaveAt);
    expect(restored.eraGateMs).toBe(state.eraGateMs);
    expect(restored.upgradeLevels).toEqual(state.upgradeLevels);
    expect(restored.protocolLevels).toEqual(state.protocolLevels);
  });

  it('LOSSLESS round-trip for an astronomically large Decimal (1e300)', () => {
    const huge = D('1e300');
    const state = { ...makeState(), revenue: huge };
    const restored = deserialize(serialize(state));
    // The restored value must equal the original (not lose precision)
    expect(restored.revenue.toString()).toBe(huge.toString());
  });

  it('LOSSLESS round-trip for ZERO', () => {
    const state = { ...makeState(), revenue: ZERO, protocol: ZERO, runPeakRevenueRate: ZERO };
    const restored = deserialize(serialize(state));
    expect(restored.revenue.toString()).toBe('0');
    expect(restored.protocol.toString()).toBe('0');
    expect(restored.runPeakRevenueRate.toString()).toBe('0');
  });

  it('round-trips a fresh initialState without errors', () => {
    const fresh = initialState(Date.now());
    const restored = deserialize(serialize(fresh));
    expect(restored.era).toBe(1);
    expect(restored.revenue.toString()).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Full symmetric round-trip (serialize → deserialize identity)
// ---------------------------------------------------------------------------

describe('serialize → deserialize identity', () => {
  it('produces a state equal to the input on all fields', () => {
    const state = makeState();
    const restored = deserialize(serialize(state));

    // Decimal fields
    expect(restored.revenue.toString()).toBe(state.revenue.toString());
    expect(restored.demand.toString()).toBe(state.demand.toString());
    expect(restored.protocol.toString()).toBe(state.protocol.toString());
    expect(restored.runPeakRevenueRate.toString()).toBe(state.runPeakRevenueRate.toString());

    // Primitive fields
    expect(restored.era).toBe(state.era);
    expect(restored.congestionEfficiency).toBe(state.congestionEfficiency);
    expect(restored.deficitMs).toBe(state.deficitMs);
    expect(restored.elapsedMs).toBe(state.elapsedMs);
    expect(restored.lastSaveAt).toBe(state.lastSaveAt);
    expect(restored.eraGateMs).toBe(state.eraGateMs);

    // Records
    expect(restored.upgradeLevels).toEqual(state.upgradeLevels);
    expect(restored.protocolLevels).toEqual(state.protocolLevels);
  });
});

// ---------------------------------------------------------------------------
// migrate — defensive validation
// ---------------------------------------------------------------------------

describe('migrate — returns null for junk input', () => {
  it('returns null for null', () => {
    expect(migrate(null)).toBeNull();
  });

  it('returns null for a number', () => {
    expect(migrate(42)).toBeNull();
  });

  it('returns null for a string', () => {
    expect(migrate('{"version":1}')).toBeNull();
  });

  it('returns null for an array', () => {
    expect(migrate([])).toBeNull();
  });

  it('returns null for an empty object (missing version)', () => {
    expect(migrate({})).toBeNull();
  });

  it('returns null for an object with a non-number version', () => {
    expect(migrate({ version: 'one' })).toBeNull();
  });

  it('returns null for a future version (SAVE_VERSION + 1)', () => {
    const future = buildCurrentVersionObject({ version: SAVE_VERSION + 1 });
    expect(migrate(future)).toBeNull();
  });

  it('returns null for an object missing required Decimal string fields', () => {
    const broken = buildCurrentVersionObject({ revenue: 999 /* should be string */ });
    expect(migrate(broken)).toBeNull();
  });

  it('returns null for an object missing upgradeLevels', () => {
    const broken = buildCurrentVersionObject({ upgradeLevels: undefined });
    expect(migrate(broken)).toBeNull();
  });

  it('returns null when a level record holds non-number values (NaN-injection guard)', () => {
    const broken = buildCurrentVersionObject({ upgradeLevels: { isdn: 'lots' } });
    expect(migrate(broken)).toBeNull();
  });
});

describe('migrate — accepts valid current-version data', () => {
  it('returns the SaveData unchanged for a well-formed current-version object', () => {
    const save = serialize(makeState());
    const result = migrate(save as unknown);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(SAVE_VERSION);
    expect(result!.revenue).toBe(save.revenue);
  });
});

describe('migrate — forward migration from an older save shape', () => {
  it('upgrades a v0-ish object (missing eraGateMs) to current version', () => {
    // Simulate a "pre-eraGateMs" save that someone might find in the wild:
    // it has all the v1 fields except eraGateMs.
    const v0like = buildCurrentVersionObject({ eraGateMs: undefined, version: 0 });
    const result = migrate(v0like);
    // The migration should patch eraGateMs to 0 (default) and bump to SAVE_VERSION.
    expect(result).not.toBeNull();
    expect(result!.version).toBe(SAVE_VERSION);
    expect(result!.eraGateMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Internal builder — produces a structurally valid current-version raw object.
// Used to craft targeted broken inputs.
// ---------------------------------------------------------------------------

function buildCurrentVersionObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = serialize(makeState()) as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete result[key];
    } else {
      result[key] = value;
    }
  }

  return result;
}
