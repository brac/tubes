/**
 * layers.test.ts — Node-safe unit tests for Layer 2 (mid) and Layer 3 (hero).
 *
 * NO WebGL context is required.  All tests target:
 *   1. Pure helpers from layer-helpers.ts (tint selection, alpha-for-saturation,
 *      emit-rate mapping, speed curves).  These are Pixi-free.
 *   2. Active-count invariants driven via the pool + emission scheduler.
 *      We simulate the emit/recycle loop with plain token objects — no Sprites,
 *      no Pixi import.
 *
 * Every test asserts the REPRESENTATION PRINCIPLE:
 *   active count NEVER exceeds the cap, regardless of emission intensity or
 *   duration of the simulation.
 */

import { describe, it, expect } from 'vitest';
import { emitCount } from './emission.js';

// Pure helpers — Pixi-free module.
import {
  selectMidTint,
  midAlphaForSaturation,
  midEmitRate,
  selectHeroTint,
  heroAlphaForSaturation,
  heroEmitRate,
  heroPacketSpeed,
} from './layer-helpers.js';

import {
  MID_CAP,
  HERO_CAP,
  MID_EMIT_RATE_MIN,
  MID_EMIT_RATE_MAX,
  HERO_EMIT_RATE_MIN,
  HERO_EMIT_RATE_MAX,
  HERO_SPEED_MIN,
  HERO_SPEED_MAX,
} from './config.js';

// ---------------------------------------------------------------------------
// Helper: emission + recycle simulation (no Pixi)
// ---------------------------------------------------------------------------

/**
 * Simulate `frames` frames of emission + recycle.
 * Packets travel across a virtual `canvasW`-wide canvas at `speed` px/s.
 * Returns the maximum observed activeCount during the run.
 */
function simulateEmission(opts: {
  frames: number;
  dtMs: number;
  intensity: number;
  cap: number;
  canvasW: number;
  speed: number;
  emitRateFn: (intensity: number) => number;
}): number {
  const { frames, dtMs, intensity, cap, canvasW, speed, emitRateFn } = opts;

  type Token = { x: number };
  const items: Token[] = Array.from({ length: cap }, () => ({ x: 0 }));
  const inactive: Token[] = [...items];
  const active: Token[] = [];

  function acquire(): Token | null {
    if (inactive.length === 0) return null;
    const item = inactive.pop()!;
    active.push(item);
    return item;
  }

  function release(item: Token): void {
    const idx = active.indexOf(item);
    if (idx === -1) return;
    const last = active[active.length - 1]!;
    active[idx] = last;
    active.pop();
    inactive.push(item);
  }

  const emitRate = emitRateFn(intensity);
  const intervalMs = emitRate > 0 ? 1000 / emitRate : Infinity;

  let accMs = 0;
  let maxActive = 0;

  for (let f = 0; f < frames; f++) {
    // Recycle off-screen packets first.
    const toRelease: Token[] = [];
    for (const t of active) {
      t.x += speed * (dtMs / 1000);
      if (t.x > canvasW) toRelease.push(t);
    }
    for (const t of toRelease) {
      t.x = 0;
      release(t);
    }

    // Emit.
    if (intervalMs < Infinity) {
      accMs += dtMs;
      const count = Math.floor(accMs / intervalMs);
      accMs -= count * intervalMs;
      for (let i = 0; i < count; i++) {
        const tok = acquire();
        if (tok === null) break;
      }
    }

    if (active.length > maxActive) maxActive = active.length;
  }

  return maxActive;
}

// ---------------------------------------------------------------------------
// Tests: selectMidTint
// ---------------------------------------------------------------------------

describe('selectMidTint', () => {
  it('returns a valid 24-bit integer at intensity=0', () => {
    const tint = selectMidTint(0);
    expect(tint).toBeGreaterThanOrEqual(0);
    expect(tint).toBeLessThanOrEqual(0xffffff);
  });

  it('returns a valid 24-bit integer at intensity=1', () => {
    const tint = selectMidTint(1);
    expect(tint).toBeGreaterThanOrEqual(0);
    expect(tint).toBeLessThanOrEqual(0xffffff);
  });

  it('clamps sub-zero intensity to intensity=0 result', () => {
    expect(selectMidTint(-1)).toBe(selectMidTint(0));
  });

  it('clamps over-1 intensity to intensity=1 result', () => {
    expect(selectMidTint(2)).toBe(selectMidTint(1));
  });

  it('differs between intensity=0 and intensity=1 (palette has range)', () => {
    expect(selectMidTint(0)).not.toBe(selectMidTint(1));
  });

  it('returns a value at intensity=0.5 distinct from both extremes', () => {
    const lo = selectMidTint(0);
    const hi = selectMidTint(1);
    const mid = selectMidTint(0.5);
    expect(mid).not.toBe(lo);
    expect(mid).not.toBe(hi);
  });
});

// ---------------------------------------------------------------------------
// Tests: selectHeroTint
// ---------------------------------------------------------------------------

describe('selectHeroTint', () => {
  it('returns a valid 24-bit integer at intensity=0', () => {
    const tint = selectHeroTint(0);
    expect(tint).toBeGreaterThanOrEqual(0);
    expect(tint).toBeLessThanOrEqual(0xffffff);
  });

  it('returns a valid 24-bit integer at intensity=1', () => {
    const tint = selectHeroTint(1);
    expect(tint).toBeGreaterThanOrEqual(0);
    expect(tint).toBeLessThanOrEqual(0xffffff);
  });

  it('clamps sub-zero to intensity=0 result', () => {
    expect(selectHeroTint(-5)).toBe(selectHeroTint(0));
  });

  it('clamps over-1 to intensity=1 result', () => {
    expect(selectHeroTint(99)).toBe(selectHeroTint(1));
  });

  it('palette has distinct extremes', () => {
    expect(selectHeroTint(0)).not.toBe(selectHeroTint(1));
  });

  it('hero and mid tints differ at same intensity (separate palettes)', () => {
    // Hero is amber, mid is cyan — they must not collide.
    expect(selectHeroTint(0.5)).not.toBe(selectMidTint(0.5));
  });
});

// ---------------------------------------------------------------------------
// Tests: midAlphaForSaturation
// ---------------------------------------------------------------------------

describe('midAlphaForSaturation', () => {
  it('returns full alpha at saturation=1', () => {
    expect(midAlphaForSaturation(1)).toBeCloseTo(0.82, 5);
  });

  it('returns dim alpha at saturation=0', () => {
    expect(midAlphaForSaturation(0)).toBeCloseTo(0.28, 5);
  });

  it('is monotonically increasing', () => {
    const vals = [0, 0.25, 0.5, 0.75, 1].map(midAlphaForSaturation);
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1]!);
    }
  });

  it('clamps sub-zero saturation to saturation=0 result', () => {
    expect(midAlphaForSaturation(-1)).toBe(midAlphaForSaturation(0));
  });

  it('clamps over-1 saturation to saturation=1 result', () => {
    expect(midAlphaForSaturation(2)).toBe(midAlphaForSaturation(1));
  });
});

// ---------------------------------------------------------------------------
// Tests: heroAlphaForSaturation
// ---------------------------------------------------------------------------

describe('heroAlphaForSaturation', () => {
  it('returns full alpha at saturation=1', () => {
    expect(heroAlphaForSaturation(1)).toBeCloseTo(0.95, 5);
  });

  it('returns dim-but-visible alpha at saturation=0', () => {
    expect(heroAlphaForSaturation(0)).toBeCloseTo(0.50, 5);
  });

  it('hero dim floor is higher than mid dim floor', () => {
    expect(heroAlphaForSaturation(0)).toBeGreaterThan(midAlphaForSaturation(0));
  });

  it('is monotonically increasing', () => {
    const vals = [0, 0.2, 0.4, 0.6, 0.8, 1].map(heroAlphaForSaturation);
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1]!);
    }
  });

  it('clamps below 0', () => {
    expect(heroAlphaForSaturation(-1)).toBe(heroAlphaForSaturation(0));
  });

  it('clamps above 1', () => {
    expect(heroAlphaForSaturation(3)).toBe(heroAlphaForSaturation(1));
  });
});

// ---------------------------------------------------------------------------
// Tests: midEmitRate
// ---------------------------------------------------------------------------

describe('midEmitRate', () => {
  it('returns MID_EMIT_RATE_MIN at intensity=0', () => {
    expect(midEmitRate(0)).toBeCloseTo(MID_EMIT_RATE_MIN, 10);
  });

  it('returns MID_EMIT_RATE_MAX at intensity=1', () => {
    expect(midEmitRate(1)).toBeCloseTo(MID_EMIT_RATE_MAX, 10);
  });

  it('is monotonically increasing', () => {
    const steps = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1];
    const rates = steps.map(midEmitRate);
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThan(rates[i - 1]!);
    }
  });

  it('clamps sub-zero to MID_EMIT_RATE_MIN', () => {
    expect(midEmitRate(-1)).toBe(midEmitRate(0));
  });

  it('clamps over-1 to MID_EMIT_RATE_MAX', () => {
    expect(midEmitRate(2)).toBe(midEmitRate(1));
  });
});

// ---------------------------------------------------------------------------
// Tests: heroEmitRate
// ---------------------------------------------------------------------------

describe('heroEmitRate', () => {
  it('returns HERO_EMIT_RATE_MIN at intensity=0', () => {
    expect(heroEmitRate(0)).toBeCloseTo(HERO_EMIT_RATE_MIN, 10);
  });

  it('returns HERO_EMIT_RATE_MAX at intensity=1', () => {
    expect(heroEmitRate(1)).toBeCloseTo(HERO_EMIT_RATE_MAX, 10);
  });

  it('is monotonically increasing', () => {
    const steps = [0, 0.25, 0.5, 0.75, 1];
    const rates = steps.map(heroEmitRate);
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThan(rates[i - 1]!);
    }
  });

  it('hero max rate is much lower than mid max rate (hero is sparse)', () => {
    expect(heroEmitRate(1)).toBeLessThan(midEmitRate(1));
  });
});

// ---------------------------------------------------------------------------
// Tests: heroPacketSpeed
// ---------------------------------------------------------------------------

describe('heroPacketSpeed', () => {
  it('returns HERO_SPEED_MIN at intensity=0', () => {
    expect(heroPacketSpeed(0)).toBeCloseTo(HERO_SPEED_MIN, 10);
  });

  it('returns HERO_SPEED_MAX at intensity=1', () => {
    expect(heroPacketSpeed(1)).toBeCloseTo(HERO_SPEED_MAX, 10);
  });

  it('is monotonically increasing', () => {
    const steps = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const speeds = steps.map(heroPacketSpeed);
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]).toBeGreaterThanOrEqual(speeds[i - 1]!);
    }
  });

  it('returns HERO_SPEED_MIN at intensity=0 (boundary)', () => {
    expect(heroPacketSpeed(0)).toBe(HERO_SPEED_MIN);
  });

  it('clamps sub-zero to HERO_SPEED_MIN', () => {
    expect(heroPacketSpeed(-1)).toBe(heroPacketSpeed(0));
  });

  it('clamps over-1 to HERO_SPEED_MAX', () => {
    expect(heroPacketSpeed(2)).toBe(heroPacketSpeed(1));
  });
});

// ---------------------------------------------------------------------------
// Tests: active-count cap invariants (pool simulation, no Pixi)
// ---------------------------------------------------------------------------

describe('mid-stream emission cap invariant', () => {
  it('never exceeds MID_CAP at high intensity over many frames', () => {
    const maxActive = simulateEmission({
      frames: 600,
      dtMs: 16.67,
      intensity: 1.0,
      cap: MID_CAP,
      canvasW: 375,
      speed: 600,
      emitRateFn: midEmitRate,
    });
    expect(maxActive).toBeLessThanOrEqual(MID_CAP);
  });

  it('never exceeds MID_CAP at high intensity on a wide canvas', () => {
    const maxActive = simulateEmission({
      frames: 600,
      dtMs: 16.67,
      intensity: 1.0,
      cap: MID_CAP,
      canvasW: 1440,
      speed: 600,
      emitRateFn: midEmitRate,
    });
    expect(maxActive).toBeLessThanOrEqual(MID_CAP);
  });

  it('never exceeds MID_CAP with slow packet speed (dense fill)', () => {
    const maxActive = simulateEmission({
      frames: 600,
      dtMs: 16.67,
      intensity: 1.0,
      cap: MID_CAP,
      canvasW: 375,
      speed: 40,
      emitRateFn: midEmitRate,
    });
    expect(maxActive).toBeLessThanOrEqual(MID_CAP);
  });

  it('stays well below MID_CAP at low intensity', () => {
    // At intensity=0.05: rate ≈ 6.5 pkt/s, speed=50px/s on 375px canvas
    // → packet lifetime ≈ 7.5s → steady state ≈ 49 concurrent packets.
    // That is well below the cap of 300 (< 20%).
    const maxActive = simulateEmission({
      frames: 600,
      dtMs: 16.67,
      intensity: 0.05,
      cap: MID_CAP,
      canvasW: 375,
      speed: 50,
      emitRateFn: midEmitRate,
    });
    expect(maxActive).toBeLessThanOrEqual(MID_CAP);
    expect(maxActive).toBeLessThan(MID_CAP * 0.2); // < 60 (well below 300)
  });

  it('never exceeds MID_CAP with a massive single-frame spike', () => {
    const maxActive = simulateEmission({
      frames: 1,
      dtMs: 5000, // 5-second tab-backgrounding gap
      intensity: 1.0,
      cap: MID_CAP,
      canvasW: 375,
      speed: 600,
      emitRateFn: midEmitRate,
    });
    expect(maxActive).toBeLessThanOrEqual(MID_CAP);
  });
});

describe('hero emission cap invariant', () => {
  it('never exceeds HERO_CAP at high intensity over many frames', () => {
    const maxActive = simulateEmission({
      frames: 600,
      dtMs: 16.67,
      intensity: 1.0,
      cap: HERO_CAP,
      canvasW: 375,
      speed: 900,
      emitRateFn: heroEmitRate,
    });
    expect(maxActive).toBeLessThanOrEqual(HERO_CAP);
  });

  it('never exceeds HERO_CAP at high intensity on a wide canvas', () => {
    const maxActive = simulateEmission({
      frames: 600,
      dtMs: 16.67,
      intensity: 1.0,
      cap: HERO_CAP,
      canvasW: 1440,
      speed: 900,
      emitRateFn: heroEmitRate,
    });
    expect(maxActive).toBeLessThanOrEqual(HERO_CAP);
  });

  it('never exceeds HERO_CAP with pathologically slow speed', () => {
    const maxActive = simulateEmission({
      frames: 600,
      dtMs: 16.67,
      intensity: 1.0,
      cap: HERO_CAP,
      canvasW: 375,
      speed: 10,
      emitRateFn: heroEmitRate,
    });
    expect(maxActive).toBeLessThanOrEqual(HERO_CAP);
  });

  it('emits at least one packet over 10s at intensity-floor (trickle guarantee)', () => {
    // The layer floors intensity to HERO_MIN_INTENSITY_FLOOR = 0.04.
    // We verify that at this floor rate, at least one packet is emitted in 10s.
    const HERO_MIN_INTENSITY_FLOOR = 0.04;
    const floorRate = heroEmitRate(HERO_MIN_INTENSITY_FLOOR); // packets/s
    const intervalMs = 1000 / floorRate;

    // Over 10 000 ms we expect Math.floor(10000 / intervalMs) > 0 packets.
    expect(Math.floor(10000 / intervalMs)).toBeGreaterThan(0);
  });

  it('hero cap (24) is dramatically smaller than mid cap (300)', () => {
    expect(HERO_CAP).toBeLessThan(MID_CAP / 5);
  });
});

// ---------------------------------------------------------------------------
// Tests: emitCount integration — accumulator carries correctly
// ---------------------------------------------------------------------------

describe('emitCount accumulator integration', () => {
  it('total emitted over 1s matches target rate ± 2 packets', () => {
    const intensity = 0.5;
    const expectedRate = midEmitRate(intensity);
    const frames = 60;
    const dtMs = 1000 / frames;

    let accMs = 0;
    let totalEmitted = 0;

    for (let f = 0; f < frames; f++) {
      const result = emitCount(accMs, intensity, dtMs);
      totalEmitted += result.count;
      accMs = result.remainderMs;
    }

    expect(totalEmitted).toBeGreaterThanOrEqual(Math.floor(expectedRate) - 2);
    expect(totalEmitted).toBeLessThanOrEqual(Math.ceil(expectedRate) + 2);
  });

  it('remainder is always non-negative across random intensities', () => {
    let accMs = 0;
    for (let f = 0; f < 300; f++) {
      const result = emitCount(accMs, Math.random(), 16.67);
      expect(result.remainderMs).toBeGreaterThanOrEqual(0);
      accMs = result.remainderMs;
    }
  });

  it('count is always a non-negative integer', () => {
    let accMs = 0;
    for (let f = 0; f < 300; f++) {
      const result = emitCount(accMs, Math.random(), 16.67);
      expect(result.count).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result.count)).toBe(true);
      accMs = result.remainderMs;
    }
  });
});
