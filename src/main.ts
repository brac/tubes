/**
 * main.ts — Tubes application entry point (Phase 4)
 *
 * Architecture layers:
 *   1. Pixi canvas  — full-viewport background layer (z-index: 0).
 *                     Pixi river rendering of tubes/nodes/particles arrives in Phase 5.
 *   2. DOM HUD      — stats overlay floating above the canvas (z-index: var(--z-hud)).
 *   3. Upgrades     — purchase panel anchored to the bottom (z-index: var(--z-panel)).
 *   4. Prestige     — Protocol tree + rebuild panel on the right.
 *   5. Offline      — "While you were away" dismissible summary (z-index: var(--z-overlay)).
 *
 * Clock rules:
 *   - The GAME LOOP uses performance.now() for dt — monotonic from page load.
 *   - The BOOT PATH uses Date.now() for wall-clock epoch comparisons across sessions.
 *   - Pure logic modules (offline.ts, tick.ts, etc.) receive time as arguments.
 *   - The PERSISTENCE layer (store.ts) stamps lastSaveAt with Date.now() at write time.
 *
 * Autosave strategy:
 *   - Interval save every AUTOSAVE_INTERVAL_MS (15 s) while in the foreground.
 *   - visibilitychange (document.hidden) and pagehide triggers save immediately —
 *     phones kill backgrounded tabs without warning.
 *   - All three paths call saveGame(state) with the live state reference.
 */

import { Application } from 'pixi.js';
import { initialState } from './game/state';
import { createGameLoop, buyUpgrade } from './game/tick';
import { mountHud } from './ui/hud';
import { mountUpgradesPanel } from './ui/upgrades-panel';
import { mountPrestigePanel } from './ui/prestige-panel';
import { mountOfflineSummary } from './ui/offline-summary';
import { buyProtocol } from './game/protocol';
import { prestige } from './game/prestige';
import { loadGame, saveGame } from './persistence/store';
import { applyOfflineEarnings } from './game/offline';
import { formatBig } from './lib/format';
import { cmp, ZERO } from './lib/bignum';
import { AUTOSAVE_INTERVAL_MS } from './game/config';
import type { GameState } from './game/state';

async function init(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) {
    throw new Error('Mount target #app not found');
  }

  // ─── 1. Pixi canvas — background layer ────────────────────────────────────
  // NOTE: Pixi rendering of the data river (tubes, nodes, flow particles)
  // arrives in Phase 5. For now the canvas is a styled background only.
  const app = new Application();

  await app.init({
    resizeTo: window,
    background: '#0a0a0f',
    antialias: true,
    // Cap at 2× so high-DPI phones don't thrash the GPU.
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: true,
  });

  // Pixi v8 exposes app.canvas (HTMLCanvasElement), not the legacy app.view.
  container.appendChild(app.canvas);

  // ─── 2. Offline summary — mount before state is known ─────────────────────
  // Mounted early so the overlay is in the DOM; only shown if earnings > 0.
  const offlineSummary = mountOfflineSummary(container);

  // ─── 3. Game state — load save or start fresh ─────────────────────────────
  // CLOCK RULE: Date.now() is the wall-clock epoch. It is used here (boot
  // boundary) and inside saveGame (write boundary). The game loop uses
  // performance.now() for dt — a different clock that must NOT be compared
  // with lastSaveAt across sessions.

  const bootEpoch = Date.now();
  let offlineGainedText = '';
  let offlineCappedMs = 0;

  const savedState = await loadGame();
  let state: GameState;

  if (savedState !== null) {
    // Compute real elapsed time since the save was written.
    // Clamp to >= 0 to guard against clock skew (machine clock moved backwards).
    const elapsedMs = Math.max(0, bootEpoch - savedState.lastSaveAt);

    const { state: afterOffline, gained, cappedMs } = applyOfflineEarnings(
      savedState,
      elapsedMs,
    );

    state = afterOffline;
    offlineCappedMs = cappedMs;

    // Only remember the gain text if there is a meaningful award to show.
    if (cappedMs > 0 && cmp(gained, ZERO) > 0) {
      offlineGainedText = formatBig(gained);
    }
  } else {
    // No save on disk — fresh game. Pass the wall-clock epoch so lastSaveAt
    // is a real timestamp (NOT performance.now which resets each page load).
    state = initialState(bootEpoch);
  }

  // ─── 4. DOM HUD ─────────────────────────────────────────────────────────
  const hud = mountHud(container);

  // ─── 5. Upgrades panel ──────────────────────────────────────────────────
  const upgradesPanel = mountUpgradesPanel(container, (upgradeId: string) => {
    state = buyUpgrade(state, upgradeId);
    render();
  });

  // ─── 6. Prestige panel ──────────────────────────────────────────────────
  const prestigePanel = mountPrestigePanel(
    container,
    // onBuyProtocol
    (nodeId: string) => {
      state = buyProtocol(state, nodeId);
      render();
    },
    // onPrestige
    () => {
      state = prestige(state);
      render();
    },
  );

  // ─── 7. Render callback ──────────────────────────────────────────────────
  function render(): void {
    hud.update(state);
    upgradesPanel.update(state);
    prestigePanel.update(state);
  }

  // Initial render before the first tick fires.
  render();

  // ─── 8. Show offline summary if earned ──────────────────────────────────
  if (offlineCappedMs > 0 && offlineGainedText !== '') {
    offlineSummary.show({
      cappedMs: offlineCappedMs,
      gainedText: offlineGainedText,
    });
  }

  // ─── 9. Game loop ────────────────────────────────────────────────────────
  createGameLoop(
    () => state,
    (newState: GameState) => {
      state = newState;
      render();
    },
    // Default clock: performance.now — monotonic, accurate for dt computation.
    // This is intentionally a DIFFERENT clock from Date.now() used above.
    performance.now.bind(performance),
  );

  // ─── 10. Autosave wiring ─────────────────────────────────────────────────
  // All three paths write the live `state` reference at call time.
  // saveGame stamps lastSaveAt with Date.now() internally — no clock reads here.

  // Interval save while in the foreground.
  setInterval(() => {
    void saveGame(state);
  }, AUTOSAVE_INTERVAL_MS);

  // Visibility save — fires when the user switches apps on mobile or tabs on desktop.
  // Phones kill backgrounded tabs without unload; this is our last chance to save.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      void saveGame(state);
    }
  });

  // pagehide — fired by browsers (especially Safari/iOS) when navigating away,
  // closing the tab, or backgrounding the app. More reliable than beforeunload
  // on mobile. Idempotent with the visibilitychange save — saving twice is fine.
  window.addEventListener('pagehide', () => {
    void saveGame(state);
  });
}

init().catch((err: unknown) => {
  // Only error path — safe to log.
  // eslint-disable-next-line no-console
  console.error('[Tubes] init failed:', err);
});
