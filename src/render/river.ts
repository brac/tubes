/**
 * river.ts — The River composer (Phase 5).
 *
 * Owns the three render layers in BACK→FRONT order inside one root Container
 * and presents a single clean public surface:
 *
 *   const river = createRiver(renderer, width, height);
 *   river.setSignals({ intensity, saturation, surge, burst });
 *   river.update(dtMs);   // fans out to all three layers
 *   river.resize(w, h);
 *   river.destroy();
 *
 * This is the seam Phase 6 plugs real game signals into — game logic computes
 * RenderSignals from state and calls setSignals(); nothing else changes here.
 *
 * LAYER ORDER (rendering doc §2):
 *   addChild order = paint order, so we add back-to-front:
 *     1. Shader river  (back,   slowest parallax)
 *     2. Mid stream    (middle, medium  parallax)
 *     3. Hero packets  (front,  fastest parallax)
 *
 * PARALLAX (rendering doc §7):
 *   Each LAYER already bakes its own depth factor into packet speed
 *   (PARALLAX_MID / PARALLAX_FRONT in layer-mid/hero; the shader expresses its
 *   scroll internally). The composer additionally applies a global parallax
 *   *time-scale* that grows slightly with intensity so faster eras FEEL faster —
 *   but the front/back RATIO is constant, so depth always reads consistently.
 *   We do this by scaling the per-frame dt fed to each layer by a constant
 *   per-layer factor; the ratios between those factors never change.
 *
 * OBJECT COST:
 *   One root Container (not drawn) + the layers' own bounded draw objects:
 *   shader(1) + mid(≤MID_CAP) + hero(≤HERO_CAP). Constant, forever.
 */

import { Container } from 'pixi.js';
import type { Renderer } from 'pixi.js';

import type { RenderSignals } from './types.js';
import { ShaderRiverLayer } from './layer-shader.js';
import { createMidLayer } from './layer-mid.js';
import { createHeroLayer } from './layer-hero.js';
import { initPacketTextures, destroyPacketTextures } from './packet-texture.js';

// ---------------------------------------------------------------------------
// Tunables (composer-local; not packet/shader math, so they live here)
// ---------------------------------------------------------------------------

/**
 * Default neutral signals before the first setSignals() call — a quiet trickle
 * so the lab boots into a calm, alive river rather than a dead black screen.
 */
const DEFAULT_SIGNALS: RenderSignals = {
  intensity: 0,
  saturation: 1,
  surge: 0,
  burst: 0,
};

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Live active-sprite counts, for the lab readout that verifies caps hold. */
export interface RiverCounts {
  /** Active mid-stream sprites this frame (must stay ≤ MID_CAP). */
  midActive: number;
  /** Active hero sprites this frame (must stay ≤ HERO_CAP). */
  heroActive: number;
}

export interface River {
  /** Root Container — add to the Pixi stage. Do not replace. */
  readonly view: Container;

  /** Update the normalized signals driving every layer (Phase 6 game seam). */
  setSignals(signals: RenderSignals): void;

  /** Advance all layers by dtMs (capped/clamped upstream and again here). */
  update(dtMs: number): void;

  /** Propagate a logical canvas resize to every layer. */
  resize(width: number, height: number): void;

  /**
   * Active-sprite counts for the debug readout. Counts currently VISIBLE
   * children of the packet layers — the same flag pools toggle on acquire/
   * release — so the lab can verify object caps hold without the River reaching
   * into layer internals. Cheap: bounded by MID_CAP + HERO_CAP.
   */
  getCounts(): RiverCounts;

  /** Tear down all layers and free shared GPU resources (textures, meshes). */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * createRiver — compose the three-layer data river.
 *
 * @param renderer  Live Pixi Renderer — required to rasterise the shared packet
 *                  textures once at startup (initPacketTextures).
 * @param width     Initial logical canvas width.
 * @param height    Initial logical canvas height.
 */
export function createRiver(
  renderer: Renderer,
  width: number,
  height: number,
): River {
  // Shared packet textures MUST exist before the packet layers build their
  // pools (they pull getMidTexture/getHeroTexture in their factories).
  initPacketTextures(renderer);

  const view = new Container();
  // The river is a passive background; never intercept pointer events so the
  // DOM HUD / debug panel above it stays fully interactive.
  view.eventMode = 'none';

  // Build layers BACK→FRONT. addChild order === paint order.
  const shaderLayer = new ShaderRiverLayer();
  const midLayer = createMidLayer(width, height);
  const heroLayer = createHeroLayer(width, height);

  view.addChild(shaderLayer.view); // back  (slowest)
  view.addChild(midLayer.view); //    middle
  view.addChild(heroLayer.view); //   front (fastest)

  // Prime initial sizing so the shader quad/uniforms and packet bands are
  // correct on the very first frame.
  shaderLayer.resize(width, height);
  midLayer.resize(width, height);
  heroLayer.resize(width, height);

  let signals: RenderSignals = DEFAULT_SIGNALS;

  // ── Public surface ───────────────────────────────────────────────────────

  function setSignals(next: RenderSignals): void {
    // Snapshot into a fresh object so external mutation of the caller's object
    // can't retroactively change what the river renders (immutability rule).
    signals = {
      intensity: clamp01(next.intensity),
      saturation: clamp01(next.saturation),
      surge: clamp01(next.surge),
      burst: clamp01(next.burst),
    };
  }

  function update(dtMs: number): void {
    // Defensive dt clamp: a backgrounded tab can return with a huge delta.
    // Layers also clamp internally, but capping here keeps the parallax sweep
    // from teleporting packets across the canvas in a single frame.
    const dt = Math.min(Math.max(dtMs, 0), 100);

    // Pass WALL-CLOCK dt to every layer. Two reasons:
    //   1. Each layer's emission accumulator must track real time so emission
    //      RATE keeps encoding intensity faithfully (a scaled dt would silently
    //      over-drive the rate at high intensity).
    //   2. The river already accelerates with intensity WITHOUT a global
    //      time-scale: packet speed has a quadratic ease-in (packetSpeed) and
    //      the shader's uFlow scales with intensity. Depth (back→front) lives in
    //      the fixed per-layer parallax factors (PARALLAX_BACK/MID/FRONT).
    // An optional intensity parallax boost (doc §7) can be reintroduced in
    // Phase 6 by threading a separate scaled dt for motion only.
    shaderLayer.update(dt, signals);
    midLayer.update(dt, signals);
    heroLayer.update(dt, signals);
  }

  function resize(w: number, h: number): void {
    shaderLayer.resize(w, h);
    midLayer.resize(w, h);
    heroLayer.resize(w, h);
  }

  function getCounts(): RiverCounts {
    return {
      midActive: countVisible(midLayer.view),
      heroActive: countVisible(heroLayer.view),
    };
  }

  function destroy(): void {
    // Destroy layers first (they reference the shared textures), then free the
    // shared textures, then the root container.
    shaderLayer.destroy();
    midLayer.destroy();
    heroLayer.destroy();
    destroyPacketTextures();
    view.destroy({ children: true });
  }

  return { view, setSignals, update, resize, getCounts, destroy };
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * countVisible — number of visible direct children of a layer's container.
 * A pooled sprite is visible iff it is active, so this mirrors the pool's
 * activeCount without the River needing access to the pool itself.
 */
function countVisible(container: Container): number {
  let n = 0;
  const children = container.children;
  for (let i = 0; i < children.length; i++) {
    if (children[i]?.visible) n++;
  }
  return n;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
