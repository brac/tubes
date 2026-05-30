/**
 * schema.ts
 *
 * Versioned save shape, serialization, deserialization, and migration for
 * Tubes save data stored in IndexedDB.
 *
 * CLOCK RULE: This module is PURE. It never reads Date.now() or any wall-clock.
 * The store/IO boundary owns clock-stamping of lastSaveAt.
 *
 * DECIMAL SERIALIZATION: Every Decimal field in GameState is stored as a plain
 * string via .toString() and reconstructed via D(string). This is lossless even
 * for values up to ~1e(1e308) (the break_infinity.js ceiling).
 *
 * CORRUPTION SAFETY: migrate() is the defensive entry-point. It validates an
 * unknown value loaded from disk and returns null if the data is unrecognisable,
 * missing required fields, or is from a future version this code cannot handle.
 * Callers must fall back to a fresh game on null.
 */

import { D } from '../lib/bignum';
import type { GameState } from '../game/state';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

/**
 * Increment this number whenever the save shape changes in a way that
 * requires a migration (added required fields, removed fields, changed
 * field semantics, etc.).
 *
 * Version history:
 *   1 — initial Phase-4 shape (all Phase-1/Phase-3 GameState fields)
 */
export const SAVE_VERSION = 1;

// ---------------------------------------------------------------------------
// SaveData — the serialized, JSON-safe representation of a GameState
// ---------------------------------------------------------------------------

/**
 * SaveData is a plain JSON-safe object.
 *
 * Decimal fields are stored as strings to survive JSON encoding without
 * precision loss. All other GameState fields are stored as-is (numbers,
 * records of numbers). The 'version' field is added by serialize() and
 * used by migrate() to drive forward-migrations.
 *
 * NOTE: Do NOT add methods or class instances here — it must be serializable
 * via JSON.stringify / JSON.parse without any reviver.
 */
export interface SaveData {
  version: number;

  // Decimal fields stored as strings
  revenue: string;
  demand: string;
  protocol: string;
  runPeakRevenueRate: string;

  // Numeric fields stored as-is
  era: number;
  congestionEfficiency: number;
  deficitMs: number;
  elapsedMs: number;
  lastSaveAt: number;
  eraGateMs: number;

  // Record fields stored as-is
  upgradeLevels: Record<string, number>;
  protocolLevels: Record<string, number>;
}

// ---------------------------------------------------------------------------
// serialize
// ---------------------------------------------------------------------------

/**
 * serialize(state) — converts a live GameState into a JSON-safe SaveData.
 *
 * Stamps version = SAVE_VERSION.
 * Does NOT stamp the clock — lastSaveAt is taken verbatim from state.lastSaveAt.
 * The IO boundary (store.ts) is responsible for updating lastSaveAt before
 * calling serialize if it wants a fresh timestamp.
 */
export function serialize(state: GameState): SaveData {
  return {
    version: SAVE_VERSION,

    // Decimal → string
    revenue: state.revenue.toString(),
    demand: state.demand.toString(),
    protocol: state.protocol.toString(),
    runPeakRevenueRate: state.runPeakRevenueRate.toString(),

    // Numbers as-is
    era: state.era,
    congestionEfficiency: state.congestionEfficiency,
    deficitMs: state.deficitMs,
    elapsedMs: state.elapsedMs,
    lastSaveAt: state.lastSaveAt,
    eraGateMs: state.eraGateMs,

    // Records — shallow copy for immutability
    upgradeLevels: { ...state.upgradeLevels },
    protocolLevels: { ...state.protocolLevels },
  };
}

// ---------------------------------------------------------------------------
// deserialize
// ---------------------------------------------------------------------------

/**
 * deserialize(data) — converts a SaveData back into a live GameState.
 *
 * Assumes data is a valid, fully-migrated SaveData (i.e. migrate() has
 * already been called and returned non-null). Does not do defensive checks
 * here — migrate() is the single validation gate.
 */
export function deserialize(data: SaveData): GameState {
  return {
    revenue: D(data.revenue),
    demand: D(data.demand),
    protocol: D(data.protocol),
    runPeakRevenueRate: D(data.runPeakRevenueRate),

    era: data.era,
    congestionEfficiency: data.congestionEfficiency,
    deficitMs: data.deficitMs,
    elapsedMs: data.elapsedMs,
    lastSaveAt: data.lastSaveAt,
    eraGateMs: data.eraGateMs,

    upgradeLevels: { ...data.upgradeLevels },
    protocolLevels: { ...data.protocolLevels },
  };
}

// ---------------------------------------------------------------------------
// migrate
// ---------------------------------------------------------------------------

/**
 * migrate(raw) — defensively validates and migrates an unknown value loaded
 * from disk into a current-version SaveData.
 *
 * Returns null when:
 *   - raw is not a plain object (null, number, string, array, etc.)
 *   - raw.version is missing or is not a finite number
 *   - raw.version is greater than SAVE_VERSION (future version — cannot handle)
 *   - basic shape validation fails (required string/number/object fields absent)
 *
 * For each known older version, applies forward-migration steps until the
 * data matches the current SAVE_VERSION shape.
 *
 * NEVER throws on bad data — all failures return null.
 */
export function migrate(raw: unknown): SaveData | null {
  // Must be a non-null plain object (not array)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  // version must be a finite number
  if (typeof obj['version'] !== 'number' || !Number.isFinite(obj['version'])) {
    return null;
  }

  const version = obj['version'] as number;

  // Reject future versions we cannot handle
  if (version > SAVE_VERSION) {
    return null;
  }

  // -------------------------------------------------------------------------
  // Forward migrations — apply in ascending version order.
  // Each block upgrades from version N to N+1.
  // After all blocks, version should equal SAVE_VERSION.
  // -------------------------------------------------------------------------

  // v0 → v1: The "pre-eraGateMs" era. Any object with version < 1 that has
  // the other required fields is patched with eraGateMs = 0 and bumped to v1.
  if (version < 1) {
    // Patch missing eraGateMs (introduced in v1)
    if (typeof obj['eraGateMs'] !== 'number') {
      obj['eraGateMs'] = 0;
    }
    obj['version'] = 1;
  }

  // -------------------------------------------------------------------------
  // Shape validation — confirm all required fields are present and typed
  // correctly for the current version (v1).
  // -------------------------------------------------------------------------

  if (!isValidV1Shape(obj)) {
    return null;
  }

  return obj as unknown as SaveData;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * isValidV1Shape — validates that obj has all fields required by SaveData v1.
 *
 * Keeps this co-located with the schema definition so it's easy to update
 * when fields are added or removed in future versions.
 */
function isValidV1Shape(obj: Record<string, unknown>): boolean {
  // Decimal string fields
  if (
    typeof obj['revenue'] !== 'string' ||
    typeof obj['demand'] !== 'string' ||
    typeof obj['protocol'] !== 'string' ||
    typeof obj['runPeakRevenueRate'] !== 'string'
  ) {
    return false;
  }

  // Numeric fields
  if (
    typeof obj['era'] !== 'number' ||
    typeof obj['congestionEfficiency'] !== 'number' ||
    typeof obj['deficitMs'] !== 'number' ||
    typeof obj['elapsedMs'] !== 'number' ||
    typeof obj['lastSaveAt'] !== 'number' ||
    typeof obj['eraGateMs'] !== 'number'
  ) {
    return false;
  }

  // Record fields must be string->number maps (reject anything that could
  // inject NaN/strings into level arithmetic downstream).
  if (!isNumberRecord(obj['upgradeLevels'])) {
    return false;
  }
  if (!isNumberRecord(obj['protocolLevels'])) {
    return false;
  }

  return true;
}

/**
 * Returns true if x is a non-null, non-array plain object whose values are all
 * finite numbers. Guards the load path against a corrupt save smuggling string
 * or NaN levels into the upgrade/protocol records.
 */
function isNumberRecord(x: unknown): x is Record<string, number> {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) {
    return false;
  }
  return Object.values(x).every((v) => typeof v === 'number' && Number.isFinite(v));
}
