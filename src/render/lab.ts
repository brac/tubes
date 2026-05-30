/**
 * lab.ts — River Lab standalone entry point (Phase 5).
 *
 * Boots a Pixi Application, mounts the three-layer River + the debug slider
 * panel, and runs a requestAnimationFrame loop that:
 *   1. reads the slider signals,
 *   2. feeds them to river.setSignals(),
 *   3. advances river.update(dtMs),
 *   4. pushes live FPS + active-count readouts back to the panel.
 *
 * DECOUPLING (rendering doc §10):
 *   This page imports NOTHING from src/game/**. It is the isolated rendering
 *   harness — the entire point is to de-risk trickle→torrent rendering without
 *   the game wired up. The only contract is RenderSignals.
 *
 * DPR cap (rendering doc §9): resolution capped at 2 so high-DPI phones don't
 * become fill-rate bound by the three transparent layers.
 */

import { Application } from 'pixi.js';

import { createRiver } from './river.js';
import { createDebugPanel } from './debug-slider.js';
import { DPR_CAP } from './config.js';

// ---------------------------------------------------------------------------
// FPS smoothing
// ---------------------------------------------------------------------------

/** Exponential-moving-average weight for the FPS readout (0..1, higher = snappier). */
const FPS_SMOOTHING = 0.1;

/** Frame delta hard cap (ms) — matches the river's own clamp; tab-return guard. */
const MAX_FRAME_DT = 100;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  const mount = document.getElementById('lab');
  if (!mount) {
    throw new Error('River Lab mount target #lab not found');
  }

  // ── Pixi application ──────────────────────────────────────────────────────
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#0a0c14', // tokens.css --color-bg deep navy-black
    antialias: true,
    // Cap DPR at 2 so very high-DPI phones don't thrash fill rate (doc §9).
    resolution: Math.min(window.devicePixelRatio, DPR_CAP),
    autoDensity: true,
  });
  mount.appendChild(app.canvas);

  // ── River ─────────────────────────────────────────────────────────────────
  // Pass the live renderer (createRiver rasterises the shared packet textures
  // once) and the current logical screen size.
  const river = createRiver(
    app.renderer,
    app.screen.width,
    app.screen.height,
  );
  app.stage.addChild(river.view);

  // ── Debug panel ────────────────────────────────────────────────────────
  const panel = createDebugPanel();
  document.body.appendChild(panel.element);

  // ── Resize wiring ─────────────────────────────────────────────────────────
  // Pixi's resizeTo:window already resizes the renderer; we just forward the new
  // logical screen size to the river so packet bands + shader uniforms update.
  function onResize(): void {
    river.resize(app.screen.width, app.screen.height);
  }
  window.addEventListener('resize', onResize);
  // Prime once in case the renderer settled at a different size than init args.
  onResize();

  // ── Animation loop ─────────────────────────────────────────────────────
  let lastTime = performance.now();
  let smoothedFps = 60;

  function frame(now: number): void {
    const rawDt = now - lastTime;
    lastTime = now;
    const dtMs = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);

    // Instantaneous FPS from the UNCLAMPED delta, EMA-smoothed for a stable read.
    if (rawDt > 0) {
      const instantFps = 1000 / rawDt;
      smoothedFps += (instantFps - smoothedFps) * FPS_SMOOTHING;
    }

    // 1. Drive the river from the sliders.
    river.setSignals(panel.getSignals());
    // 2. Advance all layers.
    river.update(dtMs);

    // 3. Update the verification readout (caps must hold across the range).
    const counts = river.getCounts();
    panel.setReadout({
      fps: smoothedFps,
      midActive: counts.midActive,
      heroActive: counts.heroActive,
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

boot().catch((err: unknown) => {
  // Only error path in the lab — safe to surface to the console.
  // eslint-disable-next-line no-console
  console.error('[River Lab] boot failed:', err);
});
