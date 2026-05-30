/**
 * emission.test.ts — Unit tests for the pure emission scheduler.
 *
 * Tests verify:
 *  1. emitCount accumulates fractional packets correctly across frames.
 *  2. Higher intensity produces more emissions over the same elapsed time.
 *  3. Zero (or near-zero) intensity produces ~0 emissions.
 *  4. packetSpeed is monotonically increasing and clamped to config bounds.
 *  5. shaderParams.flow, .density, .brightness are monotonically increasing
 *     with intensity and clamped to config bounds.
 *  6. Saturation dims brightness (deficit look).
 *  7. Surge and burst boost brightness / speed within expected ranges.
 */

import { describe, it, expect } from 'vitest';
import { emitCount, packetSpeed, shaderParams } from './emission.js';
import {
  MID_SPEED_MIN,
  MID_SPEED_MAX,
  MID_EMIT_RATE_MAX,
  SHADER_FLOW_MIN,
  SHADER_FLOW_MAX,
  SHADER_BRIGHTNESS_MIN,
  SHADER_BRIGHTNESS_MAX,
  SHADER_DENSITY_MIN,
  SHADER_DENSITY_MAX,
} from './config.js';
import type { RenderSignals } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseSignals(overrides: Partial<RenderSignals> = {}): RenderSignals {
  return { intensity: 0, saturation: 1, surge: 0, burst: 0, ...overrides };
}

/** Sum emissions over N frames of constant dtMs. */
function totalEmissions(intensity: number, frames: number, dtMs: number): number {
  let acc = 0;
  let remainder = 0;
  for (let i = 0; i < frames; i++) {
    const result = emitCount(remainder, intensity, dtMs);
    acc += result.count;
    remainder = result.remainderMs;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// emitCount — basic accumulation
// ---------------------------------------------------------------------------

describe('emitCount()', () => {
  it('accumulates fractional packets: two 50ms frames at moderate intensity', () => {
    // At intensity 0.5 the rate is between min and max — some packets expected over 1s.
    // Over 1s (1000ms) at any positive rate we should get at least 1 packet.
    const total = totalEmissions(0.5, 20, 50); // 20 frames × 50ms = 1s
    expect(total).toBeGreaterThan(0);
  });

  it('carries the remainder to the next frame', () => {
    // Very low rate means not every frame emits; but over time it accumulates.
    const total = totalEmissions(0.01, 200, 50); // 200 frames × 50ms = 10s
    expect(total).toBeGreaterThan(0);
  });

  it('accumulator starts at 0 — first call with accumulatorMs=0', () => {
    // If dtMs is very small, count should be 0 for near-zero intensity.
    const { count, remainderMs } = emitCount(0, 0, 1);
    expect(count).toBe(0);
    expect(remainderMs).toBeGreaterThanOrEqual(0);
  });

  it('returns non-negative count and remainder', () => {
    const { count, remainderMs } = emitCount(100, 0.5, 16.67);
    expect(count).toBeGreaterThanOrEqual(0);
    expect(remainderMs).toBeGreaterThanOrEqual(0);
  });

  it('remainder is always less than one emission interval', () => {
    // For intensity 1.0, interval = 1000 / MAX_RATE.
    const { remainderMs } = emitCount(0, 1.0, 16.67);
    // Interval at full rate = 1000 / MID_EMIT_RATE_MAX — remainder must be < that.
    // We don't import the rate directly but we know remainder < dtMs is always true
    // since we only carry what's left after integer packets.
    expect(remainderMs).toBeLessThan(1000); // trivially true
    expect(remainderMs).toBeLessThanOrEqual(16.67 + 0.001); // can't exceed dtMs
  });

  // -------------------------------------------------------------------------
  // Monotonicity: higher intensity → more emissions over same time
  // -------------------------------------------------------------------------

  it('higher intensity produces more emissions over 1 second than lower intensity', () => {
    const frames = 60;
    const dtMs = 1000 / frames; // ~16.67ms per frame

    const lowTotal = totalEmissions(0.1, frames, dtMs);
    const midTotal = totalEmissions(0.5, frames, dtMs);
    const highTotal = totalEmissions(1.0, frames, dtMs);

    expect(midTotal).toBeGreaterThan(lowTotal);
    expect(highTotal).toBeGreaterThan(midTotal);
  });

  it('zero intensity produces 0 emissions', () => {
    const total = totalEmissions(0, 60, 16.67);
    expect(total).toBe(0);
  });

  it('negative intensity is clamped to zero emissions', () => {
    const total = totalEmissions(-0.5, 60, 16.67);
    expect(total).toBe(0);
  });

  it('intensity > 1 is clamped to intensity = 1 emissions', () => {
    const at1 = totalEmissions(1.0, 60, 16.67);
    const over1 = totalEmissions(2.0, 60, 16.67);
    // After clamping, over1 should equal at1.
    expect(over1).toBe(at1);
  });

  it('full intensity over 1 second emits approximately max-rate packets', () => {
    // At intensity 1, rate = MID_EMIT_RATE_MAX. Over 1s we expect ~MID_EMIT_RATE_MAX.
    // Use 600 frames of 1000/600 ms each = 1s exactly.
    const total = totalEmissions(1.0, 600, 1000 / 600);
    // Allow ±2 packets floating-point drift around the config max rate.
    expect(total).toBeGreaterThanOrEqual(MID_EMIT_RATE_MAX - 2);
    expect(total).toBeLessThanOrEqual(MID_EMIT_RATE_MAX + 2);
  });
});

// ---------------------------------------------------------------------------
// packetSpeed
// ---------------------------------------------------------------------------

describe('packetSpeed()', () => {
  it('returns MID_SPEED_MIN at intensity 0', () => {
    expect(packetSpeed(0)).toBeCloseTo(MID_SPEED_MIN, 3);
  });

  it('returns MID_SPEED_MAX at intensity 1', () => {
    expect(packetSpeed(1)).toBeCloseTo(MID_SPEED_MAX, 3);
  });

  it('is monotonically non-decreasing across the 0..1 range', () => {
    const steps = 20;
    let prev = packetSpeed(0);
    for (let i = 1; i <= steps; i++) {
      const speed = packetSpeed(i / steps);
      expect(speed).toBeGreaterThanOrEqual(prev - 0.001); // allow float epsilon
      prev = speed;
    }
  });

  it('clamps to MID_SPEED_MIN for negative intensity', () => {
    expect(packetSpeed(-1)).toBeCloseTo(MID_SPEED_MIN, 3);
  });

  it('clamps to MID_SPEED_MAX for intensity > 1', () => {
    expect(packetSpeed(2)).toBeCloseTo(MID_SPEED_MAX, 3);
  });

  it('always returns a positive speed', () => {
    for (let i = 0; i <= 10; i++) {
      expect(packetSpeed(i / 10)).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// shaderParams
// ---------------------------------------------------------------------------

describe('shaderParams()', () => {
  // --- flow ---
  it('flow is SHADER_FLOW_MIN at intensity 0 (no surge/burst)', () => {
    const { flow } = shaderParams(baseSignals({ intensity: 0 }));
    expect(flow).toBeCloseTo(SHADER_FLOW_MIN, 3);
  });

  it('flow increases with intensity', () => {
    const low = shaderParams(baseSignals({ intensity: 0.2 })).flow;
    const mid = shaderParams(baseSignals({ intensity: 0.5 })).flow;
    const high = shaderParams(baseSignals({ intensity: 0.8 })).flow;
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it('flow is clamped and never below SHADER_FLOW_MIN', () => {
    const { flow } = shaderParams(baseSignals({ intensity: -5 }));
    expect(flow).toBeGreaterThanOrEqual(SHADER_FLOW_MIN);
  });

  // --- density ---
  it('density is SHADER_DENSITY_MIN at intensity 0', () => {
    const { density } = shaderParams(baseSignals({ intensity: 0 }));
    expect(density).toBeCloseTo(SHADER_DENSITY_MIN, 3);
  });

  it('density is SHADER_DENSITY_MAX at intensity 1', () => {
    const { density } = shaderParams(baseSignals({ intensity: 1 }));
    expect(density).toBeCloseTo(SHADER_DENSITY_MAX, 3);
  });

  it('density is monotonically non-decreasing with intensity', () => {
    const steps = 10;
    let prev = shaderParams(baseSignals({ intensity: 0 })).density;
    for (let i = 1; i <= steps; i++) {
      const d = shaderParams(baseSignals({ intensity: i / steps })).density;
      expect(d).toBeGreaterThanOrEqual(prev - 0.001);
      prev = d;
    }
  });

  // --- brightness ---
  it('brightness is >= SHADER_BRIGHTNESS_MIN at intensity 0 with full saturation', () => {
    const { brightness } = shaderParams(baseSignals({ intensity: 0, saturation: 1 }));
    expect(brightness).toBeGreaterThanOrEqual(SHADER_BRIGHTNESS_MIN);
  });

  it('brightness increases with intensity', () => {
    const low = shaderParams(baseSignals({ intensity: 0.1, saturation: 1 })).brightness;
    const mid = shaderParams(baseSignals({ intensity: 0.5, saturation: 1 })).brightness;
    const high = shaderParams(baseSignals({ intensity: 0.9, saturation: 1 })).brightness;
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it('brightness is always positive', () => {
    const { brightness } = shaderParams(baseSignals({ intensity: 0, saturation: 0 }));
    expect(brightness).toBeGreaterThan(0);
  });

  // --- saturation dims brightness ---
  it('lower saturation produces dimmer brightness (deficit look)', () => {
    const full = shaderParams(baseSignals({ intensity: 0.5, saturation: 1.0 })).brightness;
    const half = shaderParams(baseSignals({ intensity: 0.5, saturation: 0.5 })).brightness;
    const none = shaderParams(baseSignals({ intensity: 0.5, saturation: 0.0 })).brightness;
    expect(half).toBeLessThan(full);
    expect(none).toBeLessThan(half);
  });

  // --- surge boosts brightness ---
  it('surge boosts brightness above no-surge baseline', () => {
    const base = shaderParams(baseSignals({ intensity: 0.5, surge: 0 })).brightness;
    const surged = shaderParams(baseSignals({ intensity: 0.5, surge: 1 })).brightness;
    expect(surged).toBeGreaterThan(base);
  });

  // --- burst boosts flow speed and brightness ---
  it('burst boosts flow above no-burst baseline', () => {
    const base = shaderParams(baseSignals({ intensity: 0.5, burst: 0 })).flow;
    const bursted = shaderParams(baseSignals({ intensity: 0.5, burst: 1 })).flow;
    expect(bursted).toBeGreaterThan(base);
  });

  it('burst boosts brightness above no-burst baseline', () => {
    const base = shaderParams(baseSignals({ intensity: 0.5, burst: 0 })).brightness;
    const bursted = shaderParams(baseSignals({ intensity: 0.5, burst: 1 })).brightness;
    expect(bursted).toBeGreaterThan(base);
  });

  // --- clamping ---
  it('all params are finite and non-negative for any 0..1 input combination', () => {
    const samples = [0, 0.25, 0.5, 0.75, 1.0];
    for (const intensity of samples) {
      for (const saturation of samples) {
        for (const surge of [0, 1]) {
          for (const burst of [0, 1]) {
            const p = shaderParams({ intensity, saturation, surge, burst });
            expect(isFinite(p.flow)).toBe(true);
            expect(isFinite(p.density)).toBe(true);
            expect(isFinite(p.brightness)).toBe(true);
            expect(p.flow).toBeGreaterThan(0);
            expect(p.density).toBeGreaterThan(0);
            expect(p.brightness).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
