/**
 * store.test.ts
 *
 * Tests for store.ts — IndexedDB save/load layer.
 *
 * Written FIRST (TDD) before the implementation exists.
 *
 * fake-indexeddb/auto is imported at the top to polyfill the IndexedDB global
 * in the Node.js test environment (vitest runs in `node` mode, which has no
 * browser IndexedDB).
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { D } from '../lib/bignum';
import { initialState } from '../game/state';
import { saveGame, loadGame, clearSave } from './store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a representative GameState with non-trivial values.
 * Mirrors the helper used in schema.test.ts so the two test files are
 * independently readable.
 */
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
// Reset the database between tests so each test starts fresh.
// fake-indexeddb is in-memory per-process but object stores persist if the db
// is left open. Calling clearSave() between tests is simpler and exercises
// the clearSave() path as a side effect.
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await clearSave();
});

// ---------------------------------------------------------------------------
// loadGame — empty store
// ---------------------------------------------------------------------------

describe('loadGame — empty store', () => {
  it('returns null when no save exists', async () => {
    const result = await loadGame();
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveGame + loadGame — round-trip
// ---------------------------------------------------------------------------

describe('saveGame → loadGame round-trip', () => {
  it('returns an equivalent GameState (Decimal values intact)', async () => {
    const state = makeState();
    await saveGame(state);
    const loaded = await loadGame();

    expect(loaded).not.toBeNull();
    expect(loaded!.revenue.toString()).toBe(state.revenue.toString());
    expect(loaded!.demand.toString()).toBe(state.demand.toString());
    expect(loaded!.protocol.toString()).toBe(state.protocol.toString());
    expect(loaded!.runPeakRevenueRate.toString()).toBe(
      state.runPeakRevenueRate.toString(),
    );
  });

  it('preserves era, upgradeLevels, protocolLevels on round-trip', async () => {
    const state = makeState();
    await saveGame(state);
    const loaded = await loadGame();

    expect(loaded).not.toBeNull();
    expect(loaded!.era).toBe(state.era);
    expect(loaded!.upgradeLevels).toEqual(state.upgradeLevels);
    expect(loaded!.protocolLevels).toEqual(state.protocolLevels);
  });

  it('preserves congestionEfficiency, deficitMs, elapsedMs, eraGateMs', async () => {
    const state = makeState();
    await saveGame(state);
    const loaded = await loadGame();

    expect(loaded).not.toBeNull();
    expect(loaded!.congestionEfficiency).toBe(state.congestionEfficiency);
    expect(loaded!.deficitMs).toBe(state.deficitMs);
    expect(loaded!.elapsedMs).toBe(state.elapsedMs);
    expect(loaded!.eraGateMs).toBe(state.eraGateMs);
  });

  it('round-trips a large Decimal without precision loss (1e300)', async () => {
    const huge = D('1e300');
    const state = { ...makeState(), revenue: huge };
    await saveGame(state);
    const loaded = await loadGame();

    expect(loaded).not.toBeNull();
    expect(loaded!.revenue.toString()).toBe(huge.toString());
  });

  it('overwrites a previous save when saveGame is called again', async () => {
    const first = makeState();
    await saveGame(first);

    const second = { ...makeState(), era: 5, elapsedMs: 999_999 };
    await saveGame(second);

    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.era).toBe(5);
    expect(loaded!.elapsedMs).toBe(999_999);
  });
});

// ---------------------------------------------------------------------------
// saveGame stamps lastSaveAt
// ---------------------------------------------------------------------------

describe('saveGame — lastSaveAt stamping', () => {
  it('stamps lastSaveAt to a positive epoch (independent of input value)', async () => {
    // Pass a state with lastSaveAt far in the past so we can confirm
    // saveGame replaces it with a fresh wall-clock epoch.
    const staleLastSave = 1; // effectively epoch=1ms, well in the past
    const state = { ...makeState(), lastSaveAt: staleLastSave };

    const before = Date.now();
    await saveGame(state);
    const after = Date.now();

    const loaded = await loadGame();
    expect(loaded).not.toBeNull();

    // Loaded lastSaveAt must be a real epoch within the window of this test.
    expect(loaded!.lastSaveAt).toBeGreaterThanOrEqual(before);
    expect(loaded!.lastSaveAt).toBeLessThanOrEqual(after);
  });

  it('stores a lastSaveAt value much larger than the input stale value', async () => {
    const staleLastSave = 1_000; // a tiny epoch
    const state = { ...makeState(), lastSaveAt: staleLastSave };
    await saveGame(state);
    const loaded = await loadGame();

    expect(loaded).not.toBeNull();
    // Should be a real 2020s epoch (> 1.6 trillion), not the stale value
    expect(loaded!.lastSaveAt).toBeGreaterThan(1_600_000_000_000);
  });
});

// ---------------------------------------------------------------------------
// loadGame — corrupt / missing data safety
// ---------------------------------------------------------------------------

describe('loadGame — corruption safety', () => {
  it('returns null (does not throw) when the stored record is junk', async () => {
    // Bypass saveGame and write garbage directly into the store.
    // We import openDB here (same db name/version) so we can poke the store.
    const { openDB } = await import('idb');
    const db = await openDB('tubes', 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('save')) {
          d.createObjectStore('save');
        }
      },
    });
    await db.put('save', 'this is not valid JSON or a SaveData object', 'current');
    db.close();

    const result = await loadGame();
    expect(result).toBeNull();
  });

  it('returns null (does not throw) when the stored record is null', async () => {
    const { openDB } = await import('idb');
    const db = await openDB('tubes', 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('save')) {
          d.createObjectStore('save');
        }
      },
    });
    await db.put('save', null, 'current');
    db.close();

    const result = await loadGame();
    expect(result).toBeNull();
  });

  it('returns null (does not throw) when the record is an array', async () => {
    const { openDB } = await import('idb');
    const db = await openDB('tubes', 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('save')) {
          d.createObjectStore('save');
        }
      },
    });
    await db.put('save', [1, 2, 3], 'current');
    db.close();

    const result = await loadGame();
    expect(result).toBeNull();
  });
});
