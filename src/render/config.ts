/**
 * config.ts — Render layer constants.
 *
 * All magic numbers live here. No other render file may hardcode these values.
 *
 * Object caps
 * -----------
 * SHADER_COUNT = 1:  Layer 1 is always exactly one full-width quad.  The
 *   "infinite scale" illusion lives in the fragment shader uniforms — more
 *   throughput → faster/denser/brighter shader, never more geometry.
 *
 * MID_CAP = 300:  Layer 2 pool hard ceiling.  When the pool saturates (all
 *   300 active simultaneously) the shader takes over expressing "more".
 *
 * HERO_CAP = 24:  Layer 3 pool hard ceiling.  Always present; tiny by design
 *   so the eye can track individual packets.
 */
export const SHADER_COUNT = 1 as const;
export const MID_CAP = 300 as const;
export const HERO_CAP = 24 as const;

// ---------------------------------------------------------------------------
// Packet speed (pixels per second)
// ---------------------------------------------------------------------------

/** Mid-stream packet speed at intensity 0 (the slowest trickle). */
export const MID_SPEED_MIN = 40; // px/s

/** Mid-stream packet speed at intensity 1 (full torrent). */
export const MID_SPEED_MAX = 600; // px/s

/** Hero packet speed at intensity 0. Hero is the fastest layer. */
export const HERO_SPEED_MIN = 80; // px/s

/** Hero packet speed at intensity 1. */
export const HERO_SPEED_MAX = 900; // px/s

// ---------------------------------------------------------------------------
// Emission rate (packets per second)
// ---------------------------------------------------------------------------

/** Mid-stream emission rate at intensity 0. */
export const MID_EMIT_RATE_MIN = 0.5; // packets/s

/** Mid-stream emission rate at intensity 1.  Clamp pool prevents overflow. */
export const MID_EMIT_RATE_MAX = 120; // packets/s

/** Hero emission rate at intensity 0. */
export const HERO_EMIT_RATE_MIN = 0.25; // packets/s

/** Hero emission rate at intensity 1. */
export const HERO_EMIT_RATE_MAX = 8; // packets/s

// ---------------------------------------------------------------------------
// Parallax speed factors (applied as multipliers to packet speed)
// ---------------------------------------------------------------------------

/**
 * Layer 1 — shader river.  The quad itself doesn't translate; the scroll is
 * expressed as a uniform offset inside the fragment shader.
 * Factor is dimensionless and passed to the shader as `u_scrollSpeed`.
 */
export const PARALLAX_BACK = 0.2;

/** Layer 2 — mid stream.  Medium scroll depth. */
export const PARALLAX_MID = 0.6;

/** Layer 3 — hero packets.  Fastest scroll for foreground depth feel. */
export const PARALLAX_FRONT = 1.0;

// ---------------------------------------------------------------------------
// Packet geometry
// ---------------------------------------------------------------------------

/** Base packet width in logical pixels (before per-packet jitter). */
export const PACKET_WIDTH_BASE = 28; // px

/** Base packet height in logical pixels. */
export const PACKET_HEIGHT_BASE = 10; // px

/** Corner radius for mid-stream rounded-rect packets. */
export const PACKET_RADIUS_MID = 3; // px

/** Corner radius for hero packets (crisper). */
export const PACKET_RADIUS_HERO = 4; // px

/** Maximum ±fraction of PACKET_HEIGHT_BASE for vertical spawn jitter (0..1). */
export const PACKET_JITTER_Y = 0.6;

/** Maximum ±fraction of base dimensions for size jitter (0..1). */
export const PACKET_JITTER_SIZE = 0.25;

// ---------------------------------------------------------------------------
// Shader uniform ranges
// ---------------------------------------------------------------------------

/** Shader flow speed uniform at intensity 0. */
export const SHADER_FLOW_MIN = 0.05;

/** Shader flow speed uniform at intensity 1. */
export const SHADER_FLOW_MAX = 1.0;

/** Shader density uniform at intensity 0 (sparse ripples). */
export const SHADER_DENSITY_MIN = 0.1;

/** Shader density uniform at intensity 1 (dense river). */
export const SHADER_DENSITY_MAX = 1.0;

/** Shader brightness uniform at intensity 0 (dim glow). */
export const SHADER_BRIGHTNESS_MIN = 0.15;

/** Shader brightness uniform at intensity 1 (full bloom). */
export const SHADER_BRIGHTNESS_MAX = 1.0;

// ---------------------------------------------------------------------------
// Device pixel ratio cap
// ---------------------------------------------------------------------------

/** Hard cap on devicePixelRatio to avoid fill-rate issues on very high-DPI phones. */
export const DPR_CAP = 2;
