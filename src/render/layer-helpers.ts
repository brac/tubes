/**
 * layer-helpers.ts — Pure, Pixi-free helpers shared by layer-mid and layer-hero.
 *
 * Extracted into this module so unit tests can import the pure functions
 * without triggering the Pixi runtime (which requires a browser environment).
 *
 * Nothing in this file imports from pixi.js.
 */

import {
  MID_EMIT_RATE_MIN,
  MID_EMIT_RATE_MAX,
  HERO_EMIT_RATE_MIN,
  HERO_EMIT_RATE_MAX,
  HERO_SPEED_MIN,
  HERO_SPEED_MAX,
} from './config.js';

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * lerpColor — linearly interpolate between two 0xRRGGBB tints in sRGB.
 * Component-wise blending is good enough for palette interpolation.
 */
export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bv = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bv;
}

// ---------------------------------------------------------------------------
// Mid-stream helpers
// ---------------------------------------------------------------------------

/** Dim alpha floor at saturation=0 for mid packets. */
const MID_ALPHA_DIM = 0.28;
/** Full alpha at saturation=1 for mid packets. */
const MID_ALPHA_FULL = 0.82;

/**
 * Palette tints for mid-stream packets — CYAN family (data/flow).
 * Intensity lerps through the array index (low→high intensity = cooler→hotter).
 */
const MID_TINTS: readonly number[] = [
  0x1a5a7a, // dim teal (low intensity)
  0x0e8fa8, // muted cyan
  0x00c8d4, // bright cyan (mid)
  0x20e8f0, // near-white cyan (high)
  0x60f8ff, // icy saturated cyan (torrent)
];

/**
 * selectMidTint — map normalised intensity 0..1 to a palette tint (mid layer).
 */
export function selectMidTint(intensity: number): number {
  const t = clamp01(intensity);
  const maxIdx = MID_TINTS.length - 1;
  const fIdx = t * maxIdx;
  const lo = Math.floor(fIdx);
  const hi = Math.min(lo + 1, maxIdx);
  return lerpColor(MID_TINTS[lo]!, MID_TINTS[hi]!, fIdx - lo);
}

/**
 * midAlphaForSaturation — map saturation 0..1 to packet alpha (mid layer).
 * Full deficit dims the river; full saturation is bright.
 */
export function midAlphaForSaturation(sat: number): number {
  const s = clamp01(sat);
  return MID_ALPHA_DIM + (MID_ALPHA_FULL - MID_ALPHA_DIM) * s;
}

/**
 * midEmitRate — target packets/s for mid-stream at the given intensity.
 * Linear between MID_EMIT_RATE_MIN and MID_EMIT_RATE_MAX.
 */
export function midEmitRate(intensity: number): number {
  return lerp(MID_EMIT_RATE_MIN, MID_EMIT_RATE_MAX, clamp01(intensity));
}

// ---------------------------------------------------------------------------
// Hero helpers
// ---------------------------------------------------------------------------

/** Dim alpha floor at saturation=0 for hero packets (always legible). */
const HERO_ALPHA_DIM = 0.50;
/** Full alpha at saturation=1 for hero packets. */
const HERO_ALPHA_FULL = 0.95;

/**
 * Hero palette — AMBER → GOLD family, warm foreground contrast against
 * the cold cyan mid-stream layer.
 */
const HERO_TINTS: readonly number[] = [
  0x7a3a00, // deep amber (low intensity)
  0xb85a00, // warm amber
  0xf07800, // bright amber (mid)
  0xf0b020, // gold
  0xffd060, // pale hot gold (torrent)
];

/**
 * selectHeroTint — map normalised intensity 0..1 to a palette tint (hero layer).
 */
export function selectHeroTint(intensity: number): number {
  const t = clamp01(intensity);
  const maxIdx = HERO_TINTS.length - 1;
  const fIdx = t * maxIdx;
  const lo = Math.floor(fIdx);
  const hi = Math.min(lo + 1, maxIdx);
  return lerpColor(HERO_TINTS[lo]!, HERO_TINTS[hi]!, fIdx - lo);
}

/**
 * heroAlphaForSaturation — map saturation 0..1 to packet alpha (hero layer).
 * The dim floor (0.50) is intentionally higher than mid — hero packets are
 * always legible even in a stressed river.
 */
export function heroAlphaForSaturation(sat: number): number {
  const s = clamp01(sat);
  return HERO_ALPHA_DIM + (HERO_ALPHA_FULL - HERO_ALPHA_DIM) * s;
}

/**
 * heroEmitRate — target packets/s for hero layer at the given intensity.
 * Linear between HERO_EMIT_RATE_MIN and HERO_EMIT_RATE_MAX.
 */
export function heroEmitRate(intensity: number): number {
  return lerp(HERO_EMIT_RATE_MIN, HERO_EMIT_RATE_MAX, clamp01(intensity));
}

/**
 * heroPacketSpeed — hero packet speed (px/s) at the given intensity, pre-parallax.
 * Quadratic ease-in: trickle end is slow, torrent end accelerates visibly.
 */
export function heroPacketSpeed(intensity: number): number {
  const t = clamp01(intensity);
  return lerp(HERO_SPEED_MIN, HERO_SPEED_MAX, t * t);
}
