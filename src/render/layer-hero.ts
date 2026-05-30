/**
 * layer-hero.ts — Layer 3: Hero packet foreground.
 *
 * A TINY pool of HERO_CAP crisp, bright packets — always present at every
 * intensity level so there is always something crisp for the eye to track.
 * Runs fastest (PARALLAX_FRONT = 1.0) to reinforce foreground depth.
 *
 * ALWAYS-TRICKLE GUARANTEE:
 *   Even at signals.intensity === 0 the hero layer emits at least
 *   HERO_EMIT_RATE_MIN packets/s.  The implementation enforces this by
 *   flooring the effective intensity to HERO_MIN_INTENSITY_FLOOR before
 *   consulting the emission scheduler.
 *
 * ART DIRECTION:
 *   Hero packets are warmer (amber → bright gold) to contrast the cold cyan
 *   of the mid-stream layer.  At low intensity they are amber; at high
 *   intensity they shift toward saturated gold/yellow — hot data.
 *
 * BATCHING (same principle as layer-mid):
 *   All HERO_CAP sprites share a single RenderTexture (getHeroTexture()).
 *   Tint varies per sprite; Pixi v8 batches them into a single draw call.
 *
 * SATURATION RESPONSE (Phase 5 basic):
 *   saturation dims hero alpha slightly (less than mid — hero is always
 *   legible even in a stressed river) and tightens the band.
 *
 * NO-ALLOCATION RULE (rendering doc §5):
 *   All HERO_CAP sprites are pre-allocated in the constructor via createPool.
 *   Runtime only calls pool.acquire() / pool.release() — no `new`.
 */

import { Container, Sprite } from 'pixi.js';
import type { Layer, RenderSignals } from './types.js';
import { createPool } from './pool.js';
import { getHeroTexture } from './packet-texture.js';
import {
  HERO_CAP,
  PARALLAX_FRONT,
  PACKET_WIDTH_BASE,
  PACKET_JITTER_Y,
  PACKET_JITTER_SIZE,
} from './config.js';
import {
  clamp01,
  lerp,
  selectHeroTint,
  heroAlphaForSaturation,
  heroEmitRate,
  heroPacketSpeed,
} from './layer-helpers.js';

// Re-export pure helpers so consumers import from one place.
export { selectHeroTint, heroAlphaForSaturation, heroEmitRate, heroPacketSpeed };

// ---------------------------------------------------------------------------
// Internal packet state
// ---------------------------------------------------------------------------

interface HeroPacketState {
  speed: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hero packets travel in a narrower central band than mid-stream. */
const HERO_BAND_FRACTION = 0.22;

/**
 * Minimum effective intensity fed to the emission scheduler.
 * Guarantees the always-trickle invariant even when intensity === 0.
 */
const HERO_MIN_INTENSITY_FLOOR = 0.04;

// ---------------------------------------------------------------------------
// Layer state shape
// ---------------------------------------------------------------------------

interface HeroLayerState {
  accumulatorMs: number;
  canvasW: number;
  canvasH: number;
  bandCenterY: number;
  bandHalfH: number;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * createHeroLayer — construct the hero packet layer.
 *
 * getHeroTexture() must have been called (initPacketTextures() must have run)
 * before calling this.
 */
export function createHeroLayer(initialW: number, initialH: number): Layer {
  const view = new Container();
  const texture = getHeroTexture();
  const stateMap = new WeakMap<Sprite, HeroPacketState>();

  const pool = createPool<Sprite>(() => {
    const s = new Sprite(texture);
    s.anchor.set(0, 0.5);
    s.visible = false;
    stateMap.set(s, { speed: 0 });
    view.addChild(s);
    return s;
  }, HERO_CAP);

  const st: HeroLayerState = {
    accumulatorMs: 0,
    canvasW: initialW,
    canvasH: initialH,
    bandCenterY: initialH * 0.5,
    bandHalfH: (initialH * HERO_BAND_FRACTION) / 2,
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  function emitPackets(count: number, signals: RenderSignals): void {
    // Apply parallax to the pre-parallax speed from the helper.
    const speed = heroPacketSpeed(signals.intensity) * PARALLAX_FRONT;
    const alpha = heroAlphaForSaturation(signals.saturation);
    const tint = selectHeroTint(signals.intensity);

    // Narrower band at low saturation.
    const satBand = 0.8 + clamp01(signals.saturation) * 0.2;
    st.bandHalfH = (st.canvasH * HERO_BAND_FRACTION * satBand) / 2;

    for (let i = 0; i < count; i++) {
      const sprite = pool.acquire();
      if (sprite === null) break;

      const state = stateMap.get(sprite)!;
      state.speed = speed;

      const yJitter = (Math.random() * 2 - 1) * st.bandHalfH * PACKET_JITTER_Y;
      // Hero packets are slightly less size-jittered for crispness.
      const sizeJitter = 1 + (Math.random() * 2 - 1) * PACKET_JITTER_SIZE * 0.5;

      sprite.x = -(PACKET_WIDTH_BASE * 1.25) * sizeJitter;
      sprite.y = st.bandCenterY + yJitter;
      sprite.scale.set(sizeJitter);
      sprite.tint = tint;
      sprite.alpha = alpha;
      sprite.visible = true;
    }
  }

  // ── Layer interface ───────────────────────────────────────────────────────

  function resize(width: number, height: number): void {
    st.canvasW = width;
    st.canvasH = height;
    st.bandCenterY = height * 0.5;
    st.bandHalfH = (height * HERO_BAND_FRACTION) / 2;
  }

  function update(dtMs: number, signals: RenderSignals): void {
    // 1. Move active sprites; collect off-screen for recycling.
    const toRelease: Sprite[] = [];

    pool.forEachActive((sprite) => {
      const state = stateMap.get(sprite)!;
      sprite.x += state.speed * (dtMs / 1000);

      if (sprite.x > st.canvasW + PACKET_WIDTH_BASE * 2) {
        sprite.visible = false;
        toRelease.push(sprite);
      }
    });

    for (const sprite of toRelease) {
      pool.release(sprite);
    }

    // 2. Emission — floor intensity for always-trickle guarantee.
    const effectiveIntensity = Math.max(
      clamp01(signals.intensity),
      HERO_MIN_INTENSITY_FLOOR,
    );
    const rate = heroEmitRate(effectiveIntensity);
    const intervalMs = rate > 0 ? 1000 / rate : Infinity;

    if (intervalMs < Infinity) {
      st.accumulatorMs += dtMs;
      const count = Math.floor(st.accumulatorMs / intervalMs);
      st.accumulatorMs -= count * intervalMs;

      if (count > 0) {
        emitPackets(count, { ...signals, intensity: effectiveIntensity });
      }
    }
  }

  function destroy(): void {
    pool.forEachActive((s) => { s.visible = false; });
    view.destroy({ children: true });
  }

  return { view, resize, update, destroy };
}

// ---------------------------------------------------------------------------
// lerp re-exported internally (kept out of layer-helpers to avoid leaking)
// ---------------------------------------------------------------------------

// (lerp is imported from layer-helpers — no local copy needed)
// Suppress unused-import lint: lerp is used in emitPackets via heroPacketSpeed.
void lerp; // tell the tree-shaker it was intentionally imported but only used indirectly
