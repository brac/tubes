/**
 * tick.ts
 *
 * Fixed-timestep simulation loop and upgrade purchase utility.
 *
 * This is the ONE module allowed to read wall-clock time. All pure logic
 * modules (economy, demand, etc.) receive time deltas as arguments; only
 * the game loop calls the clock. This keeps all other logic deterministic
 * and testable.
 *
 * Exports:
 *   step(state, dtMs)                 — advance simulation by one fixed step
 *   buyUpgrade(state, upgradeId)      — attempt to purchase an upgrade (immutable)
 *   createGameLoop(getState, setState, clock) — rAF loop with fixed accumulator
 */

import { D, add, mul, sub, gte } from '../lib/bignum';
import type { GameState } from './state';
import { TICK_STEP_MS, REVENUE_PER_UNIT_PER_S } from './config';
import { riseDemand } from './demand';
import { computeBandwidth, dataCarried, updateCongestion } from './economy';
import { ERA1_UPGRADES, nextCost } from './upgrades';

// ---------------------------------------------------------------------------
// step — one fixed-timestep simulation advance
// ---------------------------------------------------------------------------

/**
 * step(state, dtMs) — pure reducer advancing the simulation by dtMs milliseconds.
 *
 * Order of operations (must not be reordered — demand must rise before revenue
 * is calculated so the congestion model sees the correct demand level):
 *   1. riseDemand  — Demand compounds upward
 *   2. accrue revenue — revenueRate * (dtMs / 1000) added to accumulated Revenue
 *   3. updateCongestion — deficitMs and congestionEfficiency updated
 *   4. advance elapsedMs
 *
 * @param state  Current immutable game state.
 * @param dtMs   Time delta in milliseconds for this step. Must be ≥ 0.
 * @returns      New GameState with updated fields. Input is never mutated.
 */
export function step(state: GameState, dtMs: number): GameState {
  // 1. Rise demand
  let next = riseDemand(state, dtMs);

  // Bandwidth depends only on upgradeLevels, which don't change within a step,
  // so compute it once and reuse it for both revenue accrual and congestion.
  const bw = computeBandwidth(next);

  // 2. Accrue revenue: rate (per second) × elapsed seconds
  const dtSec = dtMs / 1000;
  const carried = dataCarried(next, bw);
  const ratePerSec = mul(carried, D(REVENUE_PER_UNIT_PER_S));
  const gained = mul(ratePerSec, D(dtSec));
  const newRevenue = add(next.revenue, gained);

  next = { ...next, revenue: newRevenue };

  // 3. Update congestion (deficit tracking + efficiency ramp)
  next = updateCongestion(next, dtMs, bw);

  // 4. Advance elapsed time
  next = { ...next, elapsedMs: next.elapsedMs + dtMs };

  return next;
}

// ---------------------------------------------------------------------------
// buyUpgrade — immutable upgrade purchase
// ---------------------------------------------------------------------------

/**
 * buyUpgrade(state, upgradeId) — attempt to purchase the next level of an upgrade.
 *
 * Checks:
 *   - upgradeId must exist in ERA1_UPGRADES
 *   - state.revenue must be >= nextCost(upgrade, currentLevel)
 *
 * If both conditions are met, returns a new state with:
 *   - revenue reduced by the cost
 *   - upgradeLevels[upgradeId] incremented by 1
 *
 * Returns the unchanged state (same reference) if either condition fails.
 * This keeps call sites simple: they can always call buyUpgrade without
 * checking affordability themselves and just use the returned state.
 *
 * @param state      Current immutable game state.
 * @param upgradeId  The id string of the upgrade to purchase.
 * @returns          New GameState after purchase, or original state if not purchased.
 */
export function buyUpgrade(state: GameState, upgradeId: string): GameState {
  // Look up the upgrade definition
  const upgrade = ERA1_UPGRADES.find((u) => u.id === upgradeId);
  if (upgrade === undefined) {
    return state;
  }

  const currentLevel = state.upgradeLevels[upgradeId] ?? 0;
  const cost = nextCost(upgrade, currentLevel);

  // Check affordability
  if (!gte(state.revenue, cost)) {
    return state;
  }

  // Spend revenue and increment level
  const newRevenue = sub(state.revenue, cost);
  const newUpgradeLevels: Record<string, number> = {
    ...state.upgradeLevels,
    [upgradeId]: currentLevel + 1,
  };

  return {
    ...state,
    revenue: newRevenue,
    upgradeLevels: newUpgradeLevels,
  };
}

// ---------------------------------------------------------------------------
// createGameLoop — requestAnimationFrame loop with fixed-step accumulator
// ---------------------------------------------------------------------------

/**
 * ClockFn — injected time source. Default: performance.now.
 * Injectable for deterministic testing without timers.
 */
export type ClockFn = () => number;

/**
 * GameLoopHandles — returned by createGameLoop so callers can stop the loop.
 */
export interface GameLoopHandles {
  /** Stop the rAF loop. Safe to call multiple times. */
  stop: () => void;
}

/**
 * createGameLoop(getState, setState, clock?) — start the fixed-timestep game loop.
 *
 * Design:
 *   - Uses requestAnimationFrame for scheduling.
 *   - Maintains an accumulator: wall-clock time is divided into TICK_STEP_MS
 *     fixed steps so the simulation is frame-rate independent.
 *   - Clock reads happen ONLY here — all pure logic receives dtMs as an argument.
 *   - A maximum step cap (500ms) prevents a spiral-of-death after tab suspension.
 *     On returning from a long background pause the simulation only fast-forwards
 *     half a second per frame; the rest of the catch-up can be handled by the
 *     offline-progress system in a later phase.
 *
 * NOTE: requestAnimationFrame is not available in test environments (Node/jsdom
 * without an rAF polyfill). This function is integration-layer wiring — it should
 * not be unit-tested. step() and buyUpgrade() are the testable pure units.
 *
 * @param getState  Returns the current authoritative game state.
 * @param setState  Commits a new game state (triggers a re-render).
 * @param clock     Time source; defaults to performance.now.bind(performance).
 */
export function createGameLoop(
  getState: () => GameState,
  setState: (s: GameState) => void,
  clock: ClockFn = performance.now.bind(performance),
): GameLoopHandles {
  // Maximum wall-clock delta to process in a single frame (prevents spiral-of-death
  // after a tab has been backgrounded for a long time).
  const MAX_DELTA_MS = 500;

  let rafHandle: number | null = null;
  let prevTime: number = clock();
  let accumulator = 0;
  let stopped = false;

  function frame(timestamp: number): void {
    if (stopped) return;

    // Wall-clock delta since last frame, capped to prevent spiral-of-death.
    const rawDelta = timestamp - prevTime;
    const delta = Math.min(rawDelta, MAX_DELTA_MS);
    prevTime = timestamp;

    accumulator += delta;

    let state = getState();

    // Drain the accumulator in fixed-step increments.
    while (accumulator >= TICK_STEP_MS) {
      state = step(state, TICK_STEP_MS);
      accumulator -= TICK_STEP_MS;
    }

    setState(state);

    rafHandle = requestAnimationFrame(frame);
  }

  rafHandle = requestAnimationFrame(frame);

  return {
    stop(): void {
      stopped = true;
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
    },
  };
}
