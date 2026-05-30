/**
 * hud.ts
 *
 * Vanilla TS DOM HUD overlay.
 *
 * Renders a top-row stats strip showing:
 *   Revenue (with /s rate)
 *   Bandwidth (with /s label — bps is already per-second)
 *   Demand (with /s label)
 *   A surplus / at-capacity / deficit status badge
 *
 * Mount once with mountHud(container), then call updateHud(state) every frame.
 * The update function only sets textContent — cheap and layout-safe.
 *
 * No state is stored here; the HUD is a pure projection of GameState.
 */

import './hud.css';
import type { GameState } from '../game/state';
import { computeBandwidth, deficitState } from '../game/economy';
import { revenueRate } from '../game/economy';
import { formatBig, formatRate } from '../lib/format';
import { getEra } from '../game/eras';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Opaque handle returned by mountHud. Pass to updateHud each frame. */
export interface HudHandles {
  /** Update all displayed values from the current game state. */
  update: (state: GameState) => void;
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

/**
 * mountHud(container) — create and append HUD DOM nodes inside container.
 *
 * Call once during initialisation. The returned handle exposes an update()
 * method to be called every animation frame with the current state.
 *
 * @param container  The element that wraps both the canvas and the HUD overlay.
 */
export function mountHud(container: HTMLElement): HudHandles {
  const root = document.createElement('div');
  root.className = 'hud';
  root.setAttribute('aria-live', 'off'); // HUD updates too frequently for aria-live
  root.setAttribute('aria-label', 'Game stats');

  // ─── Stats bar ─────────────────────────────────────────────────────────
  const statsBar = document.createElement('div');
  statsBar.className = 'hud__stats';

  const revenueChip = createStatChip('Revenue', 'revenue');
  const bandwidthChip = createStatChip('Bandwidth', 'bandwidth');
  const demandChip = createStatChip('Demand', 'demand');
  const eraChip = createStatChip('Era', 'era');
  const protocolChip = createStatChip('Protocol', 'protocol');

  statsBar.appendChild(revenueChip.el);
  statsBar.appendChild(bandwidthChip.el);
  statsBar.appendChild(demandChip.el);
  statsBar.appendChild(eraChip.el);
  statsBar.appendChild(protocolChip.el);

  // ─── Status badge ───────────────────────────────────────────────────────
  const statusEl = document.createElement('div');
  statusEl.className = 'hud__status';
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-label', 'Network status');

  const statusDot = document.createElement('span');
  statusDot.className = 'hud__status-dot';
  statusDot.setAttribute('aria-hidden', 'true');

  const statusText = document.createElement('span');

  statusEl.appendChild(statusDot);
  statusEl.appendChild(statusText);

  root.appendChild(statsBar);
  root.appendChild(statusEl);
  container.appendChild(root);

  // ─── Update function ────────────────────────────────────────────────────
  function update(state: GameState): void {
    const bw = computeBandwidth(state);
    const rate = revenueRate(state);
    const status = deficitState(state);

    // Revenue
    revenueChip.setValue(formatBig(state.revenue));
    revenueChip.setRate(formatRate(rate));

    // Bandwidth (bps is already a rate; label it as such)
    bandwidthChip.setValue(formatBig(bw));
    bandwidthChip.setRate(`${formatBig(bw)}/s`);

    // Demand
    demandChip.setValue(formatBig(state.demand));
    demandChip.setRate(`${formatBig(state.demand)}/s`);

    // Era name
    const eraDef = getEra(state.era);
    eraChip.setValue(eraDef.name);
    eraChip.setRate(`Era ${state.era}`);

    // Protocol balance
    protocolChip.setValue(formatBig(state.protocol));
    protocolChip.setRate('permanent');

    // Status badge
    const prevStatus = statusEl.dataset['status'] ?? null;
    if (prevStatus !== status) {
      statusEl.className = `hud__status hud__status--${status}`;
      statusEl.dataset['status'] = status;
    }

    statusText.textContent = STATUS_LABEL[status] ?? status;
  }

  return { update };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

interface StatChipRefs {
  el: HTMLElement;
  setValue: (text: string) => void;
  setRate: (text: string) => void;
}

function createStatChip(label: string, modifier: string): StatChipRefs {
  const el = document.createElement('div');
  el.className = `hud__stat hud__stat--${modifier}`;

  const labelEl = document.createElement('span');
  labelEl.className = 'hud__stat-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'hud__stat-value';
  valueEl.setAttribute('aria-label', `${label} value`);

  const rateEl = document.createElement('span');
  rateEl.className = 'hud__stat-rate';
  rateEl.setAttribute('aria-label', `${label} rate`);

  el.appendChild(labelEl);
  el.appendChild(valueEl);
  el.appendChild(rateEl);

  return {
    el,
    setValue: (text: string) => {
      if (valueEl.textContent !== text) valueEl.textContent = text;
    },
    setRate: (text: string) => {
      if (rateEl.textContent !== text) rateEl.textContent = text;
    },
  };
}

const STATUS_LABEL: Record<string, string> = {
  surplus: 'Surplus',
  'at-capacity': 'At Capacity',
  deficit: 'Deficit',
};
