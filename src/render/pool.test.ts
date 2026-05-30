/**
 * pool.test.ts — Unit tests for the generic pre-allocated object pool.
 *
 * Tests verify:
 *  1. Pre-allocation: all items created at construction, not later.
 *  2. acquire() returns an item when slots are available.
 *  3. acquire() returns null when the pool is at capacity.
 *  4. release() makes a slot reusable (acquirable again).
 *  5. activeCount tracks the number of in-use items correctly.
 *  6. forEachActive() visits only active items (not released ones).
 *  7. Double-release is a silent no-op (does not corrupt the pool).
 *  8. Capacity is fixed and reported correctly.
 */

import { describe, it, expect, vi } from 'vitest';
import { createPool } from './pool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple counter-based factory for distinct, trackable items. */
function makeCounter() {
  let n = 0;
  return () => ({ id: n++ });
}

type CounterItem = { id: number };

// ---------------------------------------------------------------------------
// Pre-allocation
// ---------------------------------------------------------------------------

describe('createPool — pre-allocation', () => {
  it('calls the factory exactly `capacity` times at construction', () => {
    const factory = vi.fn(() => ({}));
    createPool(factory, 5);
    expect(factory).toHaveBeenCalledTimes(5);
  });

  it('does NOT call the factory again after construction', () => {
    const factory = vi.fn(() => ({}));
    const pool = createPool(factory, 3);
    pool.acquire();
    pool.acquire();
    expect(factory).toHaveBeenCalledTimes(3); // still exactly 3
  });

  it('throws RangeError for capacity < 1', () => {
    expect(() => createPool(() => ({}), 0)).toThrow(RangeError);
    expect(() => createPool(() => ({}), -1)).toThrow(RangeError);
  });

  it('reports the correct fixed capacity', () => {
    const pool = createPool(() => ({}), 10);
    expect(pool.capacity).toBe(10);
    // capacity never changes
    pool.acquire();
    pool.acquire();
    expect(pool.capacity).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// acquire()
// ---------------------------------------------------------------------------

describe('acquire()', () => {
  it('returns an item when slots are available', () => {
    const pool = createPool(makeCounter(), 3);
    const item = pool.acquire();
    expect(item).not.toBeNull();
  });

  it('returns distinct items on successive acquires', () => {
    const pool = createPool(makeCounter(), 3);
    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it('returns null when pool is saturated (all items active)', () => {
    const pool = createPool(makeCounter(), 2);
    pool.acquire();
    pool.acquire();
    // Now at cap
    expect(pool.acquire()).toBeNull();
  });

  it('continues returning null while saturated', () => {
    const pool = createPool(makeCounter(), 1);
    pool.acquire();
    expect(pool.acquire()).toBeNull();
    expect(pool.acquire()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// release()
// ---------------------------------------------------------------------------

describe('release()', () => {
  it('makes a slot available for re-acquisition', () => {
    const pool = createPool(makeCounter(), 1);
    const item = pool.acquire() as CounterItem;
    expect(item).not.toBeNull();
    expect(pool.acquire()).toBeNull(); // saturated

    pool.release(item);
    const second = pool.acquire();
    expect(second).not.toBeNull();
  });

  it('released item can be the same object re-acquired', () => {
    const pool = createPool(makeCounter(), 1);
    const item = pool.acquire() as CounterItem;
    pool.release(item);
    const reacquired = pool.acquire();
    // Same pre-allocated object, no new allocation.
    expect(reacquired).toBe(item);
  });

  it('allows repeated release/acquire cycles without corruption', () => {
    const pool = createPool(makeCounter(), 2);
    for (let cycle = 0; cycle < 50; cycle++) {
      const a = pool.acquire();
      const b = pool.acquire();
      expect(pool.acquire()).toBeNull();
      pool.release(a as CounterItem);
      pool.release(b as CounterItem);
    }
    // After 50 cycles pool should be fully usable.
    const a = pool.acquire();
    const b = pool.acquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(pool.acquire()).toBeNull();
  });

  it('double-release is a silent no-op (does not corrupt capacity)', () => {
    const pool = createPool(makeCounter(), 2);
    const item = pool.acquire() as CounterItem;
    pool.release(item);
    pool.release(item); // second release — should do nothing
    // Pool should allow acquiring both slots.
    const a = pool.acquire();
    const b = pool.acquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(pool.acquire()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// activeCount
// ---------------------------------------------------------------------------

describe('activeCount', () => {
  it('starts at 0', () => {
    const pool = createPool(makeCounter(), 5);
    expect(pool.activeCount).toBe(0);
  });

  it('increments on acquire', () => {
    const pool = createPool(makeCounter(), 5);
    pool.acquire();
    expect(pool.activeCount).toBe(1);
    pool.acquire();
    expect(pool.activeCount).toBe(2);
  });

  it('decrements on release', () => {
    const pool = createPool(makeCounter(), 5);
    const item = pool.acquire() as CounterItem;
    pool.acquire();
    expect(pool.activeCount).toBe(2);
    pool.release(item);
    expect(pool.activeCount).toBe(1);
  });

  it('reaches capacity when all items acquired', () => {
    const cap = 4;
    const pool = createPool(makeCounter(), cap);
    for (let i = 0; i < cap; i++) pool.acquire();
    expect(pool.activeCount).toBe(cap);
  });

  it('returns to 0 after releasing all', () => {
    const pool = createPool(makeCounter(), 3);
    const items: CounterItem[] = [];
    for (let i = 0; i < 3; i++) items.push(pool.acquire() as CounterItem);
    for (const item of items) pool.release(item);
    expect(pool.activeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// forEachActive()
// ---------------------------------------------------------------------------

describe('forEachActive()', () => {
  it('visits zero items on an empty pool', () => {
    const pool = createPool(makeCounter(), 5);
    const visited: number[] = [];
    pool.forEachActive((item) => visited.push((item as CounterItem).id));
    expect(visited).toHaveLength(0);
  });

  it('visits exactly the active items', () => {
    const pool = createPool(makeCounter(), 5);
    const a = pool.acquire() as CounterItem;
    const b = pool.acquire() as CounterItem;

    const visited: CounterItem[] = [];
    pool.forEachActive((item) => visited.push(item as CounterItem));

    expect(visited).toHaveLength(2);
    expect(visited).toContain(a);
    expect(visited).toContain(b);
  });

  it('does NOT visit released items', () => {
    const pool = createPool(makeCounter(), 5);
    const a = pool.acquire() as CounterItem;
    const b = pool.acquire() as CounterItem;
    pool.release(a);

    const visited: CounterItem[] = [];
    pool.forEachActive((item) => visited.push(item as CounterItem));

    expect(visited).toHaveLength(1);
    expect(visited).not.toContain(a);
    expect(visited).toContain(b);
  });

  it('visits all items when pool is at capacity', () => {
    const cap = 5;
    const pool = createPool(makeCounter(), cap);
    const acquired: CounterItem[] = [];
    for (let i = 0; i < cap; i++) acquired.push(pool.acquire() as CounterItem);

    const visited: CounterItem[] = [];
    pool.forEachActive((item) => visited.push(item as CounterItem));

    expect(visited).toHaveLength(cap);
    for (const item of acquired) {
      expect(visited).toContain(item);
    }
  });

  it('provides correct sequential index parameter', () => {
    const pool = createPool(makeCounter(), 5);
    pool.acquire();
    pool.acquire();
    pool.acquire();

    const indices: number[] = [];
    pool.forEachActive((_, idx) => indices.push(idx));

    expect(indices).toEqual([0, 1, 2]);
  });
});
