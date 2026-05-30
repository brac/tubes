/**
 * main.ts — Tubes application entry point (Phase 1)
 *
 * Architecture layers:
 *   1. Pixi canvas  — full-viewport background layer (z-index: 0).
 *                     Pixi river rendering of tubes/nodes/particles arrives in Phase 5.
 *   2. DOM HUD      — stats overlay floating above the canvas (z-index: var(--z-hud)).
 *   3. Upgrades     — purchase panel anchored to the bottom (z-index: var(--z-panel)).
 *
 * The game loop (tick.ts createGameLoop) owns the wall-clock. It advances
 * simulation state at a fixed 100ms step via requestAnimationFrame and calls
 * render() after each batch of ticks.
 */

import { Application } from 'pixi.js';
import { initialState } from './game/state';
import { createGameLoop, buyUpgrade } from './game/tick';
import { mountHud } from './ui/hud';
import { mountUpgradesPanel } from './ui/upgrades-panel';
import type { GameState } from './game/state';

async function init(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) {
    throw new Error('Mount target #app not found');
  }

  // ─── 1. Pixi canvas — background layer ────────────────────────────────
  // NOTE: Pixi rendering of the data river (tubes, nodes, flow particles)
  // arrives in Phase 5. For Phase 1 the canvas is a styled background only.
  const app = new Application();

  await app.init({
    resizeTo: window,
    background: '#0a0a0f',
    antialias: true,
    // Cap at 2×  so high-DPI phones don't thrash the GPU.
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: true,
  });

  // Pixi v8 exposes app.canvas (HTMLCanvasElement), not the legacy app.view.
  container.appendChild(app.canvas);

  // ─── 2. Game state — use the loop's clock for the initial timestamp ────
  let state: GameState = initialState(performance.now());

  // ─── 3. DOM HUD ────────────────────────────────────────────────────────
  const hud = mountHud(container);

  // ─── 4. Upgrades panel ─────────────────────────────────────────────────
  const upgradesPanel = mountUpgradesPanel(container, (upgradeId: string) => {
    state = buyUpgrade(state, upgradeId);
    hud.update(state);
    upgradesPanel.update(state);
  });

  // ─── 5. Render callback (called by the loop after each tick batch) ─────
  function render(): void {
    hud.update(state);
    upgradesPanel.update(state);
  }

  // Initial render before the first tick fires.
  render();

  // ─── 6. Game loop ──────────────────────────────────────────────────────
  createGameLoop(
    () => state,
    (newState: GameState) => {
      state = newState;
      render();
    },
    // Default clock: performance.now — the only place in the app that reads
    // wall-clock time. All pure logic modules receive dtMs as an argument.
    performance.now.bind(performance),
  );
}

init().catch((err: unknown) => {
  // Only error path — safe to log.
  // eslint-disable-next-line no-console
  console.error('[Tubes] init failed:', err);
});
