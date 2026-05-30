/**
 * layer-mid.ts — Layer 2: Mid-stream packet river.
 *
 * A FIXED pool of MID_CAP rounded-rect Sprites scrolling left-to-right at
 * medium parallax depth.  Emission rate and packet speed are driven by
 * RenderSignals (Phase 5: from the debug slider).
 *
 * REPRESENTATION PRINCIPLE (rendering doc §1):
 *   Higher intensity → faster packets + higher emission rate, until the pool
 *   saturates.  Once all MID_CAP sprites are active, no new sprites are added
 *   — the shader quad (Layer 1) expresses further "more".  Count stays bounded.
 *
 * NO-ALLOCATION RULE (rendering doc §5):
 *   All MID_CAP sprites are created ONCE in the constructor.  acquire() /
 *   release() from pool.ts are O(1) and alloc-free.  Per-packet jitter uses
 *   Math.random() which is fine — rendering is NOT the deterministic sim.
 *
 * BATCHING:
 *   All sprites share a single RenderTexture (getMidTexture()).  Tint is set
 *   per-sprite.  Pixi v8 batches same-texture sprites into one draw call.
 *
 * VERTICAL BAND:
 *   Packets spawn in a vertical band centred on the canvas.  The band height
 *   is BAND_FRACTION * canvasHeight, so it scales gracefully on resize.
 *
 * SATURATION RESPONSE (Phase 5 basic):
 *   saturation < 1 dims packet alpha and reduces the band height slightly,
 *   giving a "thinner/dimmer river" look without extra sprites.
 */

import { Container, Sprite } from 'pixi.js';
import type { Layer, RenderSignals } from './types.js';
import { createPool } from './pool.js';
import { emitCount, packetSpeed } from './emission.js';
import { getMidTexture } from './packet-texture.js';
import {
  MID_CAP,
  PARALLAX_MID,
  PACKET_WIDTH_BASE,
  PACKET_JITTER_Y,
  PACKET_JITTER_SIZE,
} from './config.js';
import {
  clamp01,
  selectMidTint,
  midAlphaForSaturation,
} from './layer-helpers.js';

// Re-export pure helpers so consumers import from one place.
export { selectMidTint, midAlphaForSaturation };
export { midEmitRate } from './layer-helpers.js';

// ---------------------------------------------------------------------------
// Internal packet state
// ---------------------------------------------------------------------------

/** Per-packet runtime data — stored in a WeakMap keyed by Sprite. */
interface PacketState {
  /** Speed in px/s assigned when the packet was emitted. */
  speed: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fraction of canvas height used as the packet travel band. */
const BAND_FRACTION = 0.38;

// ---------------------------------------------------------------------------
// Layer state shape
// ---------------------------------------------------------------------------

interface MidLayerState {
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
 * createMidLayer — construct the mid-stream packet layer.
 *
 * Pre-allocates all MID_CAP sprites immediately (NO-ALLOCATION rule).
 * getMidTexture() must have been called (initPacketTextures() must have run)
 * before calling this.
 */
export function createMidLayer(initialW: number, initialH: number): Layer {
  const view = new Container();
  const texture = getMidTexture();
  const stateMap = new WeakMap<Sprite, PacketState>();

  const pool = createPool<Sprite>(() => {
    const s = new Sprite(texture);
    s.anchor.set(0, 0.5); // left-centre anchor: x = left edge of packet
    s.visible = false;
    stateMap.set(s, { speed: 0 });
    view.addChild(s);
    return s;
  }, MID_CAP);

  const st: MidLayerState = {
    accumulatorMs: 0,
    canvasW: initialW,
    canvasH: initialH,
    bandCenterY: initialH * 0.5,
    bandHalfH: (initialH * BAND_FRACTION) / 2,
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  function emitPackets(count: number, signals: RenderSignals): void {
    const speed = packetSpeed(signals.intensity) * PARALLAX_MID;
    const alpha = midAlphaForSaturation(signals.saturation);
    const tint = selectMidTint(signals.intensity);

    // Slight band compression at low saturation.
    const satBand = 0.7 + clamp01(signals.saturation) * 0.3;
    st.bandHalfH = (st.canvasH * BAND_FRACTION * satBand) / 2;

    for (let i = 0; i < count; i++) {
      const sprite = pool.acquire();
      if (sprite === null) break; // pool saturated — stop, not overflow

      const state = stateMap.get(sprite)!;
      state.speed = speed;

      const yJitter = (Math.random() * 2 - 1) * st.bandHalfH * PACKET_JITTER_Y;
      const sizeJitter = 1 + (Math.random() * 2 - 1) * PACKET_JITTER_SIZE;

      sprite.x = -PACKET_WIDTH_BASE * sizeJitter;
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
    st.bandHalfH = (height * BAND_FRACTION) / 2;
  }

  function update(dtMs: number, signals: RenderSignals): void {
    // 1. Move active packets; collect off-screen ones for recycling.
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

    // 2. Emit new packets via accumulator scheduler.
    const { count, remainderMs } = emitCount(
      st.accumulatorMs,
      signals.intensity,
      dtMs,
    );
    st.accumulatorMs = remainderMs;

    if (count > 0) emitPackets(count, signals);
  }

  function destroy(): void {
    pool.forEachActive((s) => { s.visible = false; });
    view.destroy({ children: true });
  }

  return { view, resize, update, destroy };
}
