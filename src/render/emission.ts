/**
 * emission.ts — Pure emission scheduling and signal mapping.
 *
 * All functions are pure (no side effects, no global state).  No Pixi imports.
 * Node-unit-testable with Vitest in a node environment.
 *
 * DESIGN NOTE — representation over enumeration (rendering doc §1):
 *   The emission RATE encodes throughput intensity up to pool saturation.
 *   Once the pool is full the rate is capped; the shader uniform takes over.
 *   This file only computes how many packets to emit per frame — capping
 *   against pool headroom is the caller's responsibility.
 */

import {
  MID_EMIT_RATE_MIN,
  MID_EMIT_RATE_MAX,
  MID_SPEED_MIN,
  MID_SPEED_MAX,
  SHADER_FLOW_MIN,
  SHADER_FLOW_MAX,
  SHADER_DENSITY_MIN,
  SHADER_DENSITY_MAX,
  SHADER_BRIGHTNESS_MIN,
  SHADER_BRIGHTNESS_MAX,
} from './config.js';

import type { RenderSignals } from './types.js';

// ---------------------------------------------------------------------------
// Emission accumulator
// ---------------------------------------------------------------------------

/** Result of emitCount() — how many packets to spawn this frame + left-over time. */
export interface EmitResult {
  /** Integer number of packets to emit this frame (>= 0). */
  count: number;
  /**
   * Sub-frame remainder in milliseconds carried to the next call.
   * Always in [0, interval) where interval = 1000 / targetRate.
   */
  remainderMs: number;
}

/**
 * emitCount — fractional packet accumulator.
 *
 * Converts intensity (0..1) to a target emission rate, then accumulates
 * fractional packets across frames so average emission exactly matches the
 * target rate regardless of frame duration.
 *
 * Example:
 *   rate = 2.5 packets/s, dtMs = 100ms → 0.25 packets/frame.
 *   After 4 frames: accumulator crosses 1.0 → emit 1 packet, carry remainder.
 *
 * @param accumulatorMs  Carried-over milliseconds from the previous frame (>= 0).
 * @param intensity      Normalized throughput 0..1.
 * @param dtMs           Frame delta in milliseconds (> 0).
 * @returns EmitResult with integer count and new remainder.
 */
export function emitCount(
  accumulatorMs: number,
  intensity: number,
  dtMs: number,
): EmitResult {
  const clampedIntensity = clamp01(intensity);
  const rate = midEmitRate(clampedIntensity); // packets / second
  const intervalMs = rate > 0 ? 1000 / rate : Infinity;

  if (intervalMs === Infinity) {
    // Zero rate — no emissions, preserve accumulator.
    return { count: 0, remainderMs: accumulatorMs };
  }

  const elapsed = accumulatorMs + dtMs;
  const count = Math.floor(elapsed / intervalMs);
  const remainderMs = elapsed - count * intervalMs;

  return { count, remainderMs };
}

// ---------------------------------------------------------------------------
// Packet speed mapping
// ---------------------------------------------------------------------------

/**
 * packetSpeed — mid-stream packet speed for the given intensity.
 *
 * Monotonically increasing, clamped to [MID_SPEED_MIN, MID_SPEED_MAX].
 * Uses a slight ease-in curve (quadratic) so early-game trickle feels slow
 * and the torrent end of the range accelerates visibly.
 *
 * @param intensity  Normalized throughput 0..1.
 * @returns Speed in logical pixels per second.
 */
export function packetSpeed(intensity: number): number {
  const t = clamp01(intensity);
  // Quadratic ease-in: t^2 gives more range in the upper half.
  const eased = t * t;
  return lerp(MID_SPEED_MIN, MID_SPEED_MAX, eased);
}

// ---------------------------------------------------------------------------
// Shader parameter mapping
// ---------------------------------------------------------------------------

/** Uniform values consumed by the Layer 1 shader. */
export interface ShaderParams {
  /** Flow animation speed (u_flowSpeed): [SHADER_FLOW_MIN, SHADER_FLOW_MAX]. */
  flow: number;
  /** Noise density / frequency (u_density): [SHADER_DENSITY_MIN, SHADER_DENSITY_MAX]. */
  density: number;
  /** Overall brightness (u_brightness): [SHADER_BRIGHTNESS_MIN, SHADER_BRIGHTNESS_MAX]. */
  brightness: number;
}

/**
 * shaderParams — derive Layer 1 shader uniforms from the full signal set.
 *
 * - intensity drives all three uniforms as the primary control.
 * - saturation dims brightness (deficit = starved look; basic in Phase 5).
 * - surge adds a momentary brightness spike.
 * - burst adds a momentary speed and brightness boost.
 *
 * All outputs are monotonically related to intensity within each signal
 * and clamped to their respective config ranges.
 *
 * @param signals  Current RenderSignals from game state or debug slider.
 * @returns ShaderParams ready to upload as uniforms.
 */
export function shaderParams(signals: RenderSignals): ShaderParams {
  const t = clamp01(signals.intensity);
  // Linear mapping — shader already applies its own easing.
  const baseFlow = lerp(SHADER_FLOW_MIN, SHADER_FLOW_MAX, t);
  const baseDensity = lerp(SHADER_DENSITY_MIN, SHADER_DENSITY_MAX, t);
  let baseBrightness = lerp(SHADER_BRIGHTNESS_MIN, SHADER_BRIGHTNESS_MAX, t);

  // Saturation dims brightness: full deficit (saturation=0) → half brightness.
  const sat = clamp01(signals.saturation);
  // Map saturation 0..1 → brightness multiplier 0.5..1.0.
  const satFactor = 0.5 + sat * 0.5;
  baseBrightness *= satFactor;

  // Surge: brief +20% brightness at peak.
  const surge = clamp01(signals.surge);
  baseBrightness += surge * 0.2;

  // Burst: speed boost +30%, brightness boost +15% at peak.
  const burst = clamp01(signals.burst);
  const flow = clamp(baseFlow + burst * (SHADER_FLOW_MAX * 0.3), SHADER_FLOW_MIN, SHADER_FLOW_MAX * 1.3);
  const brightness = clamp(
    baseBrightness + burst * 0.15,
    SHADER_BRIGHTNESS_MIN,
    // Allow slight over-brightness for burst shimmer (capped at 1.2).
    1.2,
  );

  return {
    flow: clamp(flow, SHADER_FLOW_MIN, SHADER_FLOW_MAX * 1.3),
    density: clamp(baseDensity, SHADER_DENSITY_MIN, SHADER_DENSITY_MAX),
    brightness: clamp(brightness, SHADER_BRIGHTNESS_MIN, 1.2),
  };
}

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

/**
 * midEmitRate — target emission rate for mid-stream at the given intensity.
 *
 * Linear interpolation between config min/max.  The result is clamped.
 * (Caller pools enforce the hard cap — rate can request more than the pool
 *  can service; that is handled upstream.)
 */
function midEmitRate(intensity: number): number {
  return lerp(MID_EMIT_RATE_MIN, MID_EMIT_RATE_MAX, clamp01(intensity));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
