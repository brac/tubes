/**
 * types.ts — Shared render-layer types.
 *
 * Importing the Container TYPE only (not the runtime) keeps this file usable
 * in node-unit tests without triggering the WebGL/DOM side effects that pixi.js
 * emits on import in non-browser environments.
 */
import type { Container } from 'pixi.js';

// ---------------------------------------------------------------------------
// Signals contract
// ---------------------------------------------------------------------------

/**
 * RenderSignals — the narrow contract between game logic and renderer.
 *
 * The renderer reads only these four normalized scalars.  It never touches raw
 * big-numbers or game internals.  All values are 0..1 unless noted.
 *
 * Phase 5: values come from the debug slider.
 * Phase 6: values come from src/game/signals.ts derived from live game state.
 */
export interface RenderSignals {
  /**
   * Overall throughput intensity (0 = dead trickle, 1 = full torrent).
   *
   * Drives: mid + hero emission rate, packet speed, shader flow/density/brightness.
   * Should be log-normalized within the current era so the river always has
   * dynamic range to grow into (re-based on era jump in Phase 7).
   */
  intensity: number;

  /**
   * River "fullness" — how well bandwidth meets demand (0 = severe deficit, 1 = healthy).
   *
   * Drives: overall river brightness + packet density relative to demand.
   * Phase 5: exposed as a debug slider, basic dim/thin response.
   * Phase 6: intake pile-up and starved-river look fully wired.
   */
  saturation: number;

  /**
   * Demand surge in progress (0 = none, 1 = peak surge).
   *
   * Drives: brief brightness / turbulence boost in the shader.
   * Phase 5: basic response (slight brightness bump), full wiring Phase 6/8.
   */
  surge: number;

  /**
   * Burst tap active (0 = inactive, 1 = max burst).
   *
   * Drives: temporary overclock shimmer effect.
   * Phase 5: basic response (speed/brightness spike), full wiring Phase 8.
   */
  burst: number;
}

// ---------------------------------------------------------------------------
// Layer interface
// ---------------------------------------------------------------------------

/**
 * Layer — the common interface every render layer must implement.
 *
 * Each layer owns a Pixi Container that the parent River scene adds to the
 * stage.  Resize and update are driven externally so layers remain passive
 * and composable.
 */
export interface Layer {
  /** The Pixi Container subtree for this layer.  Add to stage; do not replace. */
  readonly view: Container;

  /**
   * Called when the canvas logical size changes.
   *
   * Layers must reposition any geometry that depends on canvas dimensions
   * (e.g. the shader quad, the vertical spawn band for packets).
   */
  resize(width: number, height: number): void;

  /**
   * Called once per animation frame, before rendering.
   *
   * @param dtMs   Frame delta time in milliseconds (capped upstream to prevent
   *               large jumps from tab backgrounding — layers should still
   *               clamp defensively if they care about spiral of death).
   * @param signals Current normalized signals from game state or debug slider.
   */
  update(dtMs: number, signals: RenderSignals): void;

  /**
   * Release all Pixi resources owned by this layer (textures, meshes, filters).
   * Called once when the river is torn down.
   */
  destroy(): void;
}
