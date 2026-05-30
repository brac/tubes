/**
 * upgrades-panel.ts
 *
 * Vanilla TS DOM upgrades panel — lists era-1 upgrades with name, level,
 * next cost, and a Buy button per card.
 *
 * Mount once with mountUpgradesPanel(container, onBuy), then call
 * updateUpgradesPanel(state) every frame to refresh affordability and values.
 *
 * The panel never reads from or writes to game state directly — it receives
 * state as data and emits buy intents via the onBuy callback.
 */

import './upgrades-panel.css';
import type { GameState } from '../game/state';
import { ERA1_UPGRADES } from '../game/upgrades';
import { nextCost } from '../game/upgrades';
import { formatBig } from '../lib/format';
import { gte } from '../lib/bignum';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback fired when the player clicks a Buy button. */
export type OnBuyFn = (upgradeId: string) => void;

/** Opaque handle returned by mountUpgradesPanel. */
export interface UpgradesPanelHandles {
  /** Refresh all cards to reflect the current game state. Call each frame. */
  update: (state: GameState) => void;
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

/**
 * mountUpgradesPanel(container, onBuy) — create and append the upgrades panel.
 *
 * @param container  Element to append the panel into (e.g. #app).
 * @param onBuy      Called with the upgrade id whenever the player buys.
 */
export function mountUpgradesPanel(
  container: HTMLElement,
  onBuy: OnBuyFn,
): UpgradesPanelHandles {
  const panel = document.createElement('section');
  panel.className = 'upgrades-panel';
  panel.setAttribute('aria-label', 'Upgrades');

  const heading = document.createElement('h2');
  heading.className = 'upgrades-panel__heading';
  heading.textContent = 'Upgrades';

  const list = document.createElement('ul');
  list.className = 'upgrades-panel__list';
  list.setAttribute('role', 'list');

  // Build one card per upgrade; keep references for cheap updates.
  const cards = ERA1_UPGRADES.map((upgrade) => {
    const card = buildUpgradeCard(upgrade.id, upgrade.name, () => onBuy(upgrade.id));
    list.appendChild(card.li);
    return card;
  });

  panel.appendChild(heading);
  panel.appendChild(list);
  container.appendChild(panel);

  // ─── Update function ────────────────────────────────────────────────────
  function update(state: GameState): void {
    ERA1_UPGRADES.forEach((upgrade, i) => {
      const card = cards[i];
      if (card === undefined) return;

      const level = state.upgradeLevels[upgrade.id] ?? 0;
      const cost = nextCost(upgrade, level);
      const affordable = gte(state.revenue, cost);

      card.setLevel(level);
      card.setCost(formatBig(cost));
      card.setAffordable(affordable);
    });
  }

  return { update };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

interface UpgradeCardRefs {
  li: HTMLElement;
  setLevel: (level: number) => void;
  setCost: (costStr: string) => void;
  setAffordable: (affordable: boolean) => void;
}

function buildUpgradeCard(
  id: string,
  name: string,
  onBuy: () => void,
): UpgradeCardRefs {
  const li = document.createElement('li');
  li.className = 'upgrade-card';
  li.dataset['upgradeId'] = id;

  // Name
  const nameEl = document.createElement('div');
  nameEl.className = 'upgrade-card__name';
  nameEl.textContent = name;

  // Level
  const levelEl = document.createElement('div');
  levelEl.className = 'upgrade-card__level';
  const levelNumEl = document.createElement('span');
  levelNumEl.className = 'upgrade-card__level-num';
  levelNumEl.textContent = '0';
  levelEl.appendChild(document.createTextNode('Lv '));
  levelEl.appendChild(levelNumEl);

  // Cost
  const costEl = document.createElement('div');
  costEl.className = 'upgrade-card__cost';

  // Buy button
  const buyBtn = document.createElement('button');
  buyBtn.className = 'upgrade-card__buy';
  buyBtn.type = 'button';
  buyBtn.textContent = 'Buy';
  buyBtn.setAttribute('aria-label', `Buy ${name}`);
  buyBtn.addEventListener('click', onBuy);

  li.appendChild(nameEl);
  li.appendChild(levelEl);
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
        li.classList.add('upgrade-card--affordable');
      } else {
        li.classList.remove('upgrade-card--affordable');
      }
    },
  };
}
