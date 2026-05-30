/**
 * prestige-panel.ts
 *
 * "Rebuild the Backbone" — Protocol tree + prestige action + era-gate progress.
 *
 * Mount once with mountPrestigePanel(container, onBuyProtocol, onPrestige).
 * Call update(state) each render frame.
 *
 * The panel is a pure projection of GameState — it does not read or write
 * state directly. All mutations are emitted via callbacks.
 *
 * Layout (top → bottom):
 *   1. Protocol balance chip
 *   2. Era-gate progress (era name + progress bar + caption)
 *   3. Protocol tree (one card per PROTOCOL_NODES entry)
 *   4. "Rebuild the Backbone" prestige button (bottom of panel)
 */

import './prestige-panel.css';
import type { GameState } from '../game/state';
import { PROTOCOL_NODES, costForProtocolLevel } from '../game/protocol';
import { canPrestige, protocolGain } from '../game/prestige';
import { getEra, hasNextEra } from '../game/eras';
import { formatBig } from '../lib/format';
import { gte } from '../lib/bignum';
import { ERA_GATE_WINDOW_MS } from '../game/config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Called when the player clicks a Protocol node buy button. */
export type OnBuyProtocolFn = (nodeId: string) => void;

/** Called when the player confirms "Rebuild the Backbone". */
export type OnPrestigeFn = () => void;

/** Opaque handle returned by mountPrestigePanel. */
export interface PrestigePanelHandles {
  /** Refresh the panel to reflect the current game state. Call each frame. */
  update: (state: GameState) => void;
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

/**
 * mountPrestigePanel(container, onBuyProtocol, onPrestige)
 *
 * Creates and appends the prestige panel inside container.
 * Returns a handle whose update() method should be called every render frame.
 *
 * @param container       Element to append the panel into.
 * @param onBuyProtocol   Emitted with node id when a Protocol node is purchased.
 * @param onPrestige      Emitted when "Rebuild the Backbone" is confirmed.
 */
export function mountPrestigePanel(
  container: HTMLElement,
  onBuyProtocol: OnBuyProtocolFn,
  onPrestige: OnPrestigeFn,
): PrestigePanelHandles {
  // ─── Panel root ──────────────────────────────────────────────────────────
  const panel = document.createElement('section');
  panel.className = 'prestige-panel';
  panel.setAttribute('aria-label', 'Protocol and rebuild');

  // ─── 1. Protocol balance ─────────────────────────────────────────────────
  const balanceEl = buildBalanceChip();

  // ─── 2. Era gate ─────────────────────────────────────────────────────────
  const eraGate = buildEraGate();

  // ─── 3. Protocol tree ────────────────────────────────────────────────────
  const treeHeading = document.createElement('h3');
  treeHeading.className = 'prestige-panel__tree-heading';
  treeHeading.textContent = 'Protocol';

  const nodeList = document.createElement('ul');
  nodeList.className = 'prestige-panel__nodes';
  nodeList.setAttribute('role', 'list');

  const nodeCards = PROTOCOL_NODES.map((node) => {
    const card = buildProtocolNode(node.id, node.name, node.description, () =>
      onBuyProtocol(node.id),
    );
    nodeList.appendChild(card.li);
    return card;
  });

  // ─── 4. Rebuild button ───────────────────────────────────────────────────
  const rebuildBtn = buildRebuildButton(onPrestige);

  // ─── Assemble ────────────────────────────────────────────────────────────
  panel.appendChild(balanceEl.el);
  panel.appendChild(eraGate.el);
  panel.appendChild(treeHeading);
  panel.appendChild(nodeList);
  panel.appendChild(rebuildBtn.el);
  container.appendChild(panel);

  // ─── Update function ──────────────────────────────────────────────────────
  function update(state: GameState): void {
    // 1. Protocol balance
    balanceEl.setValue(formatBig(state.protocol));

    // 2. Era gate
    const eraDef = getEra(state.era);
    const isMaxEra = !hasNextEra(state.era);
    const gateProgress = isMaxEra
      ? 1
      : Math.min(1, state.eraGateMs / ERA_GATE_WINDOW_MS);
    eraGate.setEraName(eraDef.name);
    eraGate.setProgress(gateProgress, isMaxEra);

    // 3. Protocol nodes
    PROTOCOL_NODES.forEach((node, i) => {
      const card = nodeCards[i];
      if (card === undefined) return;

      const level = state.protocolLevels[node.id] ?? 0;
      const cost = costForProtocolLevel(node, level);
      const affordable = gte(state.protocol, cost);

      card.setLevel(level);
      card.setCost(formatBig(cost));
      card.setAffordable(affordable);
    });

    // 4. Rebuild button
    const eligible = canPrestige(state);
    const gain = eligible ? formatBig(protocolGain(state)) : null;
    rebuildBtn.setEligible(eligible, gain);
  }

  return { update };
}

// ---------------------------------------------------------------------------
// Sub-builders
// ---------------------------------------------------------------------------

interface BalanceChipRefs {
  el: HTMLElement;
  setValue: (text: string) => void;
}

function buildBalanceChip(): BalanceChipRefs {
  const el = document.createElement('div');
  el.className = 'prestige-panel__balance';

  const label = document.createElement('span');
  label.className = 'prestige-panel__balance-label';
  label.textContent = 'Protocol';

  const value = document.createElement('span');
  value.className = 'prestige-panel__balance-value';
  value.setAttribute('aria-label', 'Protocol balance');
  value.textContent = '0';

  el.appendChild(label);
  el.appendChild(value);

  let cachedValue = '';
  return {
    el,
    setValue(text: string): void {
      if (text === cachedValue) return;
      cachedValue = text;
      value.textContent = text;
    },
  };
}

// ---------------------------------------------------------------------------

interface EraGateRefs {
  el: HTMLElement;
  setEraName: (name: string) => void;
  setProgress: (fraction: number, isMax: boolean) => void;
}

function buildEraGate(): EraGateRefs {
  const el = document.createElement('div');
  el.className = 'prestige-panel__era-gate';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Era advancement gate');

  const header = document.createElement('div');
  header.className = 'prestige-panel__era-header';

  const eraLabel = document.createElement('span');
  eraLabel.className = 'prestige-panel__era-label';
  eraLabel.textContent = 'Era';

  const eraName = document.createElement('span');
  eraName.className = 'prestige-panel__era-name';
  eraName.textContent = '';

  header.appendChild(eraLabel);
  header.appendChild(eraName);

  const track = document.createElement('div');
  track.className = 'prestige-panel__gate-track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', 'Era gate progress');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', '0');

  const fill = document.createElement('div');
  fill.className = 'prestige-panel__gate-fill';
  track.appendChild(fill);

  const caption = document.createElement('div');
  caption.className = 'prestige-panel__gate-caption';

  el.appendChild(header);
  el.appendChild(track);
  el.appendChild(caption);

  let cachedName = '';
  let cachedProgress = -1;
  let cachedIsMax: boolean | null = null;

  return {
    el,
    setEraName(name: string): void {
      if (name === cachedName) return;
      cachedName = name;
      eraName.textContent = name;
    },
    setProgress(fraction: number, isMax: boolean): void {
      if (fraction === cachedProgress && isMax === cachedIsMax) return;
      cachedProgress = fraction;
      cachedIsMax = isMax;

      // Progress bar fill via transform (compositor-friendly)
      fill.style.transform = `scaleX(${fraction})`;
      const pct = Math.round(fraction * 100);
      track.setAttribute('aria-valuenow', String(pct));

      if (isMax) {
        el.className = 'prestige-panel__era-gate prestige-panel__era-gate--max';
        caption.textContent = 'Final era reached';
      } else if (fraction > 0) {
        el.className =
          'prestige-panel__era-gate prestige-panel__era-gate--active';
        caption.textContent = `${pct}% — maintain surplus to advance`;
      } else {
        el.className = 'prestige-panel__era-gate';
        caption.textContent = 'Sustain surplus for 30 s to advance era';
      }
    },
  };
}

// ---------------------------------------------------------------------------

interface ProtocolNodeCardRefs {
  li: HTMLElement;
  setLevel: (level: number) => void;
  setCost: (costStr: string) => void;
  setAffordable: (affordable: boolean) => void;
}

function buildProtocolNode(
  id: string,
  name: string,
  description: string,
  onBuy: () => void,
): ProtocolNodeCardRefs {
  const li = document.createElement('li');
  li.className = 'protocol-node';
  li.dataset['nodeId'] = id;

  const nameEl = document.createElement('div');
  nameEl.className = 'protocol-node__name';
  nameEl.textContent = name;

  const levelEl = document.createElement('div');
  levelEl.className = 'protocol-node__level';
  const levelNumEl = document.createElement('span');
  levelNumEl.className = 'protocol-node__level-num';
  levelNumEl.textContent = '0';
  levelEl.appendChild(document.createTextNode('Lv '));
  levelEl.appendChild(levelNumEl);

  const descEl = document.createElement('div');
  descEl.className = 'protocol-node__desc';
  descEl.textContent = description;

  const costEl = document.createElement('div');
  costEl.className = 'protocol-node__cost';

  const buyBtn = document.createElement('button');
  buyBtn.className = 'protocol-node__buy';
  buyBtn.type = 'button';
  buyBtn.textContent = 'Buy';
  buyBtn.setAttribute('aria-label', `Buy ${name}`);
  buyBtn.addEventListener('click', onBuy);

  li.appendChild(nameEl);
  li.appendChild(levelEl);
  li.appendChild(descEl);
  li.appendChild(costEl);
  li.appendChild(buyBtn);

  let cachedLevel = -1;
  let cachedCost = '';
  let cachedAffordable: boolean | null = null;

  return {
    li,
    setLevel(level: number): void {
      if (level === cachedLevel) return;
      cachedLevel = level;
      levelNumEl.textContent = String(level);
    },
    setCost(costStr: string): void {
      if (costStr === cachedCost) return;
      cachedCost = costStr;
      costEl.textContent = costStr;
    },
    setAffordable(affordable: boolean): void {
      if (affordable === cachedAffordable) return;
      cachedAffordable = affordable;
      buyBtn.disabled = !affordable;
      if (affordable) {
        li.classList.add('protocol-node--affordable');
      } else {
        li.classList.remove('protocol-node--affordable');
      }
    },
  };
}

// ---------------------------------------------------------------------------

interface RebuildButtonRefs {
  el: HTMLElement;
  setEligible: (eligible: boolean, gainStr: string | null) => void;
}

function buildRebuildButton(onPrestige: OnPrestigeFn): RebuildButtonRefs {
  const btn = document.createElement('button');
  btn.className = 'prestige-panel__rebuild';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Rebuild the Backbone — prestige reset');

  const labelLine = document.createElement('span');
  labelLine.className = 'prestige-panel__rebuild-label';
  labelLine.textContent = 'Rebuild the Backbone';

  const gainLine = document.createElement('span');
  gainLine.className = 'prestige-panel__rebuild-gain';
  gainLine.textContent = 'Build up your revenue rate to unlock';

  btn.appendChild(labelLine);
  btn.appendChild(gainLine);

  btn.addEventListener('click', () => {
    if (!btn.disabled) onPrestige();
  });

  let cachedEligible: boolean | null = null;
  let cachedGain: string | null = null;

  return {
    el: btn,
    setEligible(eligible: boolean, gainStr: string | null): void {
      if (eligible === cachedEligible && gainStr === cachedGain) return;
      cachedEligible = eligible;
      cachedGain = gainStr;

      btn.disabled = !eligible;
      if (eligible && gainStr !== null) {
        gainLine.textContent = `+${gainStr} Protocol on rebuild`;
        btn.setAttribute(
          'aria-label',
          `Rebuild the Backbone — gain +${gainStr} Protocol`,
        );
      } else {
        gainLine.textContent = 'Build up your revenue rate to unlock';
        btn.setAttribute('aria-label', 'Rebuild the Backbone — prestige reset');
      }
    },
  };
}
