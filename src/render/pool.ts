/**
 * pool.ts — Generic pre-allocated object pool.
 *
 * THE NO-ALLOCATION RULE (rendering doc §5):
 *   All pool items are created ONCE at construction time via the factory
 *   function.  acquire() and release() never call `new` or allocate heap.
 *   This keeps GC pressure near zero on mobile frame boundaries.
 *
 * Usage:
 *   const pool = createPool(() => new Sprite(texture), MID_CAP);
 *   const sprite = pool.acquire();   // returns Sprite or null if at cap
 *   pool.release(sprite);            // returns it to the inactive list
 *   pool.forEachActive(s => s.x++);  // iterate only live items
 *
 * Generic — no Pixi imports — so this file stays node-unit-testable.
 */

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface Pool<T> {
  /**
   * Pull an inactive item from the pool and mark it active.
   * Returns null if all items are currently active (pool saturated).
   * Never allocates.
   */
  acquire(): T | null;

  /**
   * Return an active item to the inactive list.
   * Silently ignores a double-release of the same item (safe to call twice).
   */
  release(item: T): void;

  /**
   * Iterate over all currently active items.
   * The callback receives the item and its current index within the active set.
   *
   * NOTE: Do not call release() inside the callback — the active array
   * is iterated directly (no snapshot copy) for zero-allocation iteration.
   * If release-during-iteration is needed in future, upgrade to a copy approach.
   */
  forEachActive(fn: (item: T, index: number) => void): void;

  /** Number of currently active (in-use) items. */
  readonly activeCount: number;

  /** Total capacity — fixed at construction. */
  readonly capacity: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * createPool — build a fixed-capacity pool.
 *
 * @param factory  Called exactly `capacity` times at construction to pre-allocate
 *                 every item.  Never called again during runtime.
 * @param capacity Maximum number of simultaneously active items (>= 1).
 */
export function createPool<T>(factory: () => T, capacity: number): Pool<T> {
  if (capacity < 1) {
    throw new RangeError(`Pool capacity must be >= 1, got ${capacity}`);
  }

  // --- Storage ---
  // inactive: stack of currently unused items.  We grow from index 0 upward;
  //   inactiveTop tracks the next free slot (= current inactive count).
  // active: unsorted list of in-use items.  Swap-remove keeps O(1) release.
  const inactive: T[] = [];
  const active: T[] = [];

  // Pre-allocate ALL items exactly once.
  for (let i = 0; i < capacity; i++) {
    inactive.push(factory());
  }

  return {
    acquire(): T | null {
      if (inactive.length === 0) return null;

      // Pop from inactive stack — O(1).
      const item = inactive.pop() as T;
      active.push(item);
      return item;
    },

    release(item: T): void {
      const idx = active.indexOf(item);
      if (idx === -1) return; // double-release guard (silent no-op)

      // Swap-remove from active — O(1), avoids shifting the array.
      const last = active[active.length - 1] as T;
      active[idx] = last;
      active.pop();

      // Push back onto inactive stack — O(1).
      inactive.push(item);
    },

    forEachActive(fn: (item: T, index: number) => void): void {
      // Length snapshot so any releases triggered externally mid-loop don't
      // cause index-out-of-range issues (belt-and-suspenders).
      const len = active.length;
      for (let i = 0; i < len; i++) {
        fn(active[i] as T, i);
      }
    },

    get activeCount(): number {
      return active.length;
    },

    get capacity(): number {
      return capacity;
    },
  };
}
