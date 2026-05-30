/**
 * protocol.ts
 *
 * Protocol tree — the permanent-upgrade layer that survives prestige.
 *
 * Exports:
 *   PROTOCOL_NODES        — catalog of purchasable permanent nodes
 *   costForProtocolLevel  — geometric cost curve for a given node + level
 *   revenueMultiplier     — pure multiplier (≥ 1) from state.protocolLevels
 *   bandwidthMultiplier   — pure multiplier (≥ 1)
 *   upgradeCostMultiplier — pure multiplier (≤ 1, discount, floored)
 *   offlineMultiplier     — pure multiplier (≥ 1, consumed by Phase 4)
 *   buyProtocol           — immutable reducer: spend protocol, gain a level
 *
 * IMPORTANT: this module MUST NOT import economy.ts or tick.ts to avoid
 * circular dependencies.  It may only import from lib/bignum and game/state.
 */

import { D, ZERO, ONE, mul, pow, max, min, sub, gte } from '../lib/bignum';
import type { Decimal } from '../lib/bignum';
import type { GameState } from './state';

// ---------------------------------------------------------------------------
// ProtocolNode type
// ---------------------------------------------------------------------------

/**
 * Describes a single permanent-upgrade node in the Protocol tree.
 */
export interface ProtocolNode {
  /** Unique identifier — used as the key in GameState.protocolLevels. */
  id: string;

  /** Human-readable name shown in the UI. */
  name: string;

  /** Flavour / gameplay description shown in the Protocol panel. */
  description: string;

  /**
   * Protocol cost for level 0 (the first purchase).
   * Subsequent levels cost  baseCost × costGrowth^level  (0-indexed).
   */
  baseCost: Decimal;

  /**
   * Per-level cost growth multiplier (must be > 1).
   * Recommended range: 1.5–3.0 so Protocol feels scarce.
   */
  costGrowth: number;

  /**
   * Per-level additive bonus applied to this node's effect.
   * Interpretation varies by node (see individual nodes below).
   */
  effectPerLevel: number;
}

// ---------------------------------------------------------------------------
// Node catalog
// ---------------------------------------------------------------------------

/**
 * PROTOCOL_NODES — the four permanent upgrade nodes available to the player.
 *
 * Effect formulas (pure functions of level):
 *   revenue-boost   :  multiplier = 1 + 0.10 × level   (+10% Revenue/s per level)
 *   bandwidth-boost :  multiplier = 1 + 0.10 × level   (+10% Bandwidth per level)
 *   upgrade-discount:  multiplier = max(FLOOR, 1 - 0.03 × level)  (-3% upgrade cost per level)
 *   offline-boost   :  multiplier = 1 + 0.20 × level   (+20% offline earnings per level)
 *
 * Costs are intentionally steep (Protocol is rare):
 *   Level 0: baseCost
 *   Level N: baseCost × costGrowth^N
 */
export const PROTOCOL_NODES: readonly ProtocolNode[] = [
  {
    id: 'revenue-boost',
    name: 'Revenue Protocol',
    description: 'Optimised billing routines. +10% Revenue per second per level.',
    baseCost: D(1),
    costGrowth: 2.0,
    effectPerLevel: 0.10,
  },
  {
    id: 'bandwidth-boost',
    name: 'Bandwidth Protocol',
    description: 'Upgraded trunk-line firmware. +10% Bandwidth per level.',
    baseCost: D(1),
    costGrowth: 2.0,
    effectPerLevel: 0.10,
  },
  {
    id: 'upgrade-discount',
    name: 'Supply Chain Protocol',
    description:
      'Bulk-procurement contracts. -3% within-era upgrade cost per level (min 50%).',
    baseCost: D(2),
    costGrowth: 2.5,
    effectPerLevel: 0.03,
  },
  {
    id: 'offline-boost',
    name: 'Offline Protocol',
    description:
      'Autonomous switching gear keeps earning while you are away. +20% offline earnings per level.',
    baseCost: D(2),
    costGrowth: 2.5,
    effectPerLevel: 0.20,
  },
] as const;

// ---------------------------------------------------------------------------
// Floor for upgrade-cost discount
// ---------------------------------------------------------------------------

/**
 * The minimum value that upgradeCostMultiplier may return.
 * 0.5 means no upgrade ever costs less than 50% of its unmodified price.
 */
export const UPGRADE_COST_MULTIPLIER_FLOOR = 0.5;

// ---------------------------------------------------------------------------
// Cost helper
// ---------------------------------------------------------------------------

/**
 * costForProtocolLevel(node, level) — Protocol cost of a purchase at the
 * given 0-indexed level.
 *
 * Formula: baseCost × costGrowth^level
 *
 * Returns a new Decimal (immutability contract).
 */
export function costForProtocolLevel(node: ProtocolNode, level: number): Decimal {
  return mul(node.baseCost, pow(D(node.costGrowth), D(level)));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns the current level of a node (0 if never purchased). */
function levelOf(state: GameState, nodeId: string): number {
  return state.protocolLevels[nodeId] ?? 0;
}

/** Look up a node by id; returns undefined if not found. */
function findNode(nodeId: string): ProtocolNode | undefined {
  return PROTOCOL_NODES.find((n) => n.id === nodeId);
}

// ---------------------------------------------------------------------------
// Pure multiplier accessors
// ---------------------------------------------------------------------------

/**
 * revenueMultiplier(state) — global Revenue-per-second multiplier.
 *
 * Formula: 1 + effectPerLevel × level
 * Always ≥ 1.
 */
export function revenueMultiplier(state: GameState): Decimal {
  const node = findNode('revenue-boost')!;
  const level = levelOf(state, 'revenue-boost');
  // 1 + effectPerLevel × level
  return D(1 + node.effectPerLevel * level);
}

/**
 * bandwidthMultiplier(state) — global Bandwidth multiplier.
 *
 * Formula: 1 + effectPerLevel × level
 * Always ≥ 1.
 */
export function bandwidthMultiplier(state: GameState): Decimal {
  const node = findNode('bandwidth-boost')!;
  const level = levelOf(state, 'bandwidth-boost');
  return D(1 + node.effectPerLevel * level);
}

/**
 * upgradeCostMultiplier(state) — within-era upgrade cost discount factor.
 *
 * Formula: max(FLOOR, 1 - effectPerLevel × level)
 * Always ≤ 1 and ≥ UPGRADE_COST_MULTIPLIER_FLOOR.
 */
export function upgradeCostMultiplier(state: GameState): Decimal {
  const node = findNode('upgrade-discount')!;
  const level = levelOf(state, 'upgrade-discount');
  const raw = 1 - node.effectPerLevel * level;
  const clamped = Math.max(UPGRADE_COST_MULTIPLIER_FLOOR, raw);
  return D(clamped);
}

/**
 * offlineMultiplier(state) — offline-earnings multiplier.
 * Phase 4 will wire this into the catch-up tick logic.
 *
 * Formula: 1 + effectPerLevel × level
 * Always ≥ 1.
 */
export function offlineMultiplier(state: GameState): Decimal {
  const node = findNode('offline-boost')!;
  const level = levelOf(state, 'offline-boost');
  return D(1 + node.effectPerLevel * level);
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * buyProtocol(state, nodeId) — attempt to purchase the next level of a
 * Protocol node.
 *
 * Immutability contract: always returns a NEW GameState on success.
 * Returns the SAME reference (no-op) when:
 *   - nodeId is not found in PROTOCOL_NODES
 *   - state.protocol < cost of the next level
 *
 * @param state   Current game state.
 * @param nodeId  Id of the Protocol node to purchase.
 * @returns Updated state, or the original state if purchase is not possible.
 */
export function buyProtocol(state: GameState, nodeId: string): GameState {
  // Unknown node → same ref
  const node = findNode(nodeId);
  if (node === undefined) return state;

  // Current level for this node
  const currentLevel = levelOf(state, nodeId);

  // Cost of the next level (0-indexed: buying from currentLevel to currentLevel+1
  // costs the price at currentLevel)
  const cost = costForProtocolLevel(node, currentLevel);

  // Unaffordable → same ref
  if (!gte(state.protocol, cost)) return state;

  // Spend and increment
  return {
    ...state,
    protocol: sub(state.protocol, cost),
    protocolLevels: {
      ...state.protocolLevels,
      [nodeId]: currentLevel + 1,
    },
  };
}
