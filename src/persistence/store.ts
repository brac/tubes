/**
 * store.ts
 *
 * IndexedDB persistence layer for Tubes save data.
 *
 * CLOCK RULE: This module is the ONLY place that reads the wall-clock epoch
 * (Date.now()). It stamps lastSaveAt immediately before serializing so the
 * saved record reflects the actual moment of the write.
 *
 * CORRUPTION SAFETY: loadGame() never throws to the caller. Any error —
 * blocked DB, corrupted record, migration failure — is caught, logged once,
 * and results in a null return so the app can start a fresh game.
 *
 * DB layout:
 *   database: "tubes"   version: 1
 *   object store: "save"
 *   key: "current"      (single-record slot; put always overwrites)
 */

import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { GameState } from '../game/state';
import { serialize, deserialize, migrate } from './schema';

// ---------------------------------------------------------------------------
// Constants — all tunable values live here, not scattered across the module
// ---------------------------------------------------------------------------

/** IndexedDB database name. */
const DB_NAME = 'tubes';

/** IndexedDB schema version. Bump when stores/indexes change. */
const DB_VERSION = 1;

/** Object store name. */
const STORE_NAME = 'save';

/** The single key used for the save slot. */
const SAVE_KEY = 'current';

// ---------------------------------------------------------------------------
// Internal — open (or reuse) the database connection
// ---------------------------------------------------------------------------

/**
 * openSaveDB — opens the tubes IndexedDB and creates the "save" object store
 * on first run (or whenever DB_VERSION bumps).
 *
 * Returns the open IDBPDatabase instance. Callers are responsible for calling
 * db.close() when done if they want to free the connection; for the typical
 * app lifecycle (open once, keep alive) that is fine to skip.
 */
async function openSaveDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// saveGame
// ---------------------------------------------------------------------------

/**
 * saveGame(state) — serializes state into a SaveData record and writes it to
 * IndexedDB under the fixed "current" key.
 *
 * Stamps lastSaveAt with Date.now() BEFORE serializing — this is the single
 * allowed wall-clock read for the persistence boundary. The original state
 * object is not mutated (immutable spread used internally).
 *
 * Never throws: a failed write (quota exceeded, Safari private mode, blocked
 * DB) is caught and logged once, and the function resolves to false. This
 * keeps the `void saveGame(state)` autosave call sites from producing
 * unhandled promise rejections on mobile browsers.
 *
 * @param state  The live GameState to persist.
 * @returns      true if the write succeeded, false if it was caught/skipped.
 */
export async function saveGame(state: GameState): Promise<boolean> {
  // Stamp the wall-clock epoch. We build a one-off object to avoid mutating
  // the caller's state (immutability convention).
  const stamped: GameState = { ...state, lastSaveAt: Date.now() };
  const data = serialize(stamped);

  try {
    const db = await openSaveDB();
    try {
      await db.put(STORE_NAME, data, SAVE_KEY);
    } finally {
      db.close();
    }
    return true;
  } catch (err: unknown) {
    // Storage can fail on mobile (quota, private mode, ITP). Log once; the
    // game keeps running and the next autosave will retry.
    // eslint-disable-next-line no-console
    console.error('[Tubes] saveGame failed:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// loadGame
// ---------------------------------------------------------------------------

/**
 * loadGame() — reads the save record from IndexedDB, runs migrate() to
 * validate and forward-migrate the raw data, then deserializes into a live
 * GameState.
 *
 * Returns null when:
 *   - No save record exists (first launch)
 *   - migrate() rejects the record (corrupt data, future version, etc.)
 *   - Any unexpected error occurs (blocked DB, quota exceeded, etc.)
 *
 * NEVER throws — callers can safely start a fresh game on null.
 */
export async function loadGame(): Promise<GameState | null> {
  try {
    const db = await openSaveDB();
    let raw: unknown;
    try {
      raw = await db.get(STORE_NAME, SAVE_KEY);
    } finally {
      db.close();
    }

    // No record stored yet
    if (raw === undefined) {
      return null;
    }

    // Run migration + shape validation
    const migrated = migrate(raw);
    if (migrated === null) {
      return null;
    }

    return deserialize(migrated);
  } catch (err: unknown) {
    // Single guarded error log — do not propagate, app falls back to fresh game
    console.error('[store] loadGame failed — starting fresh:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// clearSave (debugging / testing utility)
// ---------------------------------------------------------------------------

/**
 * clearSave() — removes the save record from IndexedDB.
 *
 * Intended for debugging and test teardown. Not called by production game code.
 */
export async function clearSave(): Promise<void> {
  try {
    const db = await openSaveDB();
    try {
      await db.delete(STORE_NAME, SAVE_KEY);
    } finally {
      db.close();
    }
  } catch {
    // Silently ignore — if the DB doesn't exist yet, there is nothing to clear
  }
}
