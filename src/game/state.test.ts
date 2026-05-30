/**
 * state.test.ts
 *
 * Tests for state.ts — GameState type and initialState factory.
 *
 * Written FIRST (TDD). Tests describe the Phase-3 contract additions:
 * protocol, protocolLevels, runPeakRevenueRate, eraGateMs.
 */

import { describe, it, expect } from 'vitest';
import { initialState } from './state';
import { ZERO } from '../lib/bignum';

// ---------------------------------------------------------------------------
// initialState
// ---------------------------------------------------------------------------

describe('initialState', () => {
  it('returns a state where protocol starts at ZERO', () => {
    const state = initialState(0);
    expect(state.protocol.toNumber()).toBe(0);
  });

  it('returns a state where protocolLevels is an empty object', () => {
    const state = initialState(0);
    expect(state.protocolLevels).toEqual({});
  });

  it('returns a state where runPeakRevenueRate starts at ZERO', () => {
    const state = initialState(0);
    expect(state.runPeakRevenueRate.toNumber()).toBe(0);
  });

  it('returns a state where eraGateMs starts at 0', () => {
    const state = initialState(0);
    expect(state.eraGateMs).toBe(0);
  });

  it('still initialises all pre-Phase-3 fields correctly', () => {
    const now = 12345;
    const state = initialState(now);

    expect(state.revenue.toNumber()).toBe(0);
    expect(state.era).toBe(1);
    expect(state.upgradeLevels).toEqual({});
    expect(state.congestionEfficiency).toBe(1.0);
    expect(state.deficitMs).toBe(0);
    expect(state.elapsedMs).toBe(0);
    expect(state.lastSaveAt).toBe(now);
  });

  it('returns a new object each time (not a shared singleton)', () => {
    const a = initialState(0);
    const b = initialState(0);
    expect(a).not.toBe(b);
  });

  it('protocol and runPeakRevenueRate are Decimal instances', () => {
    const state = initialState(0);
    // Decimal instances have a toNumber method
    expect(typeof state.protocol.toNumber).toBe('function');
    expect(typeof state.runPeakRevenueRate.toNumber).toBe('function');
  });

  it('protocolLevels is an independent object per call (no shared reference)', () => {
    const a = initialState(0);
    const b = initialState(0);
    a.protocolLevels['test-node'] = 1;
    expect(b.protocolLevels['test-node']).toBeUndefined();
  });
});
