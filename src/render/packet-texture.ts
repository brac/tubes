/**
 * packet-texture.ts — Shared packet capsule textures.
 *
 * Builds exactly TWO RenderTextures at startup (one for mid-stream, one for
 * hero), then hands them out forever.  Every packet in the same layer shares
 * a texture and is tinted per-sprite so Pixi batches the entire pool into a
 * single draw call (same texture + batch-compatible tints).
 *
 * WHY TWO TEXTURES?
 *   Mid and hero differ in geometry (size, radius) so they need distinct base
 *   textures.  Using two is fine — still exactly two draw calls per frame for
 *   the combined packet layers, which is negligible.
 *
 * NO-ALLOCATION RULE (rendering doc §5):
 *   Textures are created once (here) and never re-created.  All sprites are
 *   pre-allocated by their respective layer pools; this module just provides
 *   the shared Texture reference.
 */

import { Graphics, RenderTexture, type Renderer } from 'pixi.js';
import {
  PACKET_WIDTH_BASE,
  PACKET_HEIGHT_BASE,
  PACKET_RADIUS_MID,
  PACKET_RADIUS_HERO,
} from './config.js';

// ---------------------------------------------------------------------------
// Texture cache (module-level singleton after init)
// ---------------------------------------------------------------------------

let midTexture: RenderTexture | null = null;
let heroTexture: RenderTexture | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * initPacketTextures — create the shared packet textures.
 *
 * Must be called once after the Pixi renderer is constructed but before any
 * packet sprites are created.  Idempotent: calling it again is a no-op.
 *
 * @param renderer  The live Pixi Renderer (needed to generate render textures).
 */
export function initPacketTextures(renderer: Renderer): void {
  if (midTexture !== null) return; // already initialised

  midTexture = buildCapsuleTexture(
    renderer,
    PACKET_WIDTH_BASE,
    PACKET_HEIGHT_BASE,
    PACKET_RADIUS_MID,
  );

  heroTexture = buildCapsuleTexture(
    renderer,
    // Hero packets are slightly wider/taller for foreground crispness.
    Math.round(PACKET_WIDTH_BASE * 1.25),
    Math.round(PACKET_HEIGHT_BASE * 1.3),
    PACKET_RADIUS_HERO,
  );
}

/**
 * getMidTexture — return the shared mid-stream packet texture.
 * Throws if initPacketTextures() has not been called.
 */
export function getMidTexture(): RenderTexture {
  if (midTexture === null) {
    throw new Error('packet-texture: call initPacketTextures() first');
  }
  return midTexture;
}

/**
 * getHeroTexture — return the shared hero packet texture.
 * Throws if initPacketTextures() has not been called.
 */
export function getHeroTexture(): RenderTexture {
  if (heroTexture === null) {
    throw new Error('packet-texture: call initPacketTextures() first');
  }
  return heroTexture;
}

/**
 * destroyPacketTextures — release GPU memory.
 * Call when tearing down the river (River.destroy()).
 */
export function destroyPacketTextures(): void {
  midTexture?.destroy(true);
  heroTexture?.destroy(true);
  midTexture = null;
  heroTexture = null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * buildCapsuleTexture — rasterise a rounded-rect into a RenderTexture.
 *
 * Draws a white rounded-rect (0xffffff) so per-sprite tint is the only color
 * source.  The Graphics object is destroyed after render — it is a throwaway
 * drawing primitive, not a retained scene node.
 *
 * @param renderer  Live Pixi renderer.
 * @param w         Logical width in px.
 * @param h         Logical height in px.
 * @param r         Corner radius in px.
 */
function buildCapsuleTexture(
  renderer: Renderer,
  w: number,
  h: number,
  r: number,
): RenderTexture {
  const g = new Graphics();

  // White fill — tint drives the actual color per sprite.
  g.roundRect(0, 0, w, h, r).fill(0xffffff);

  // Soft glow: a slightly larger, semi-transparent white rect behind the
  // capsule body creates an ambient halo without a full filter pass.
  // Rendered first (back-to-front) so it sits behind the solid body.
  const glowG = new Graphics();
  const pad = 2;
  glowG.roundRect(-pad, -pad, w + pad * 2, h + pad * 2, r + pad).fill({
    color: 0xffffff,
    alpha: 0.25,
  });

  // Composite: glow behind, body on top.
  const rt = RenderTexture.create({
    width: w + pad * 2,
    height: h + pad * 2,
  });

  // Offset the body graphics so the glow padding is visible all around.
  g.x = pad;
  g.y = pad;

  renderer.render({ container: glowG, target: rt, clear: true });
  renderer.render({ container: g, target: rt, clear: false });

  // Teardown temporary graphics (not scene nodes).
  g.destroy();
  glowG.destroy();

  return rt;
}
