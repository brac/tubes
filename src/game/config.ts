/**
 * config.ts
 *
 * All Phase-1 tuning constants as named exports.
 *
 * No magic numbers anywhere else in the codebase — every numeric knob lives
 * here so tuning a feel issue means editing one file.
 *
 * Units are noted inline. "bps" = bits per second (the in-game bandwidth unit).
 */

// ---------------------------------------------------------------------------
// Tick / simulation timing
// ---------------------------------------------------------------------------

/**
 * Fixed-timestep tick duration in milliseconds.
 * The game logic advances in discrete steps of this size.
 * Keeping it at 100ms (10 Hz) keeps CPU usage low on idle games.
 */
export const TICK_STEP_MS = 100;

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

/**
 * Base Revenue earned per bit-per-second carried, per second of real time.
 * i.e. if you carry 1 bps for 1 second you earn REVENUE_PER_UNIT_PER_S Revenue.
 * Multiply by (data carried) × (elapsed seconds) to get total Revenue gained.
 */
export const REVENUE_PER_UNIT_PER_S = 1;

// ---------------------------------------------------------------------------
// Demand rise
// ---------------------------------------------------------------------------

/**
 * Continuous compounding rate for Demand, expressed as a multiplier applied
 * per SECOND. A value of 1.0005 means Demand grows 0.05% every second, or
 * roughly ×1.03 per minute. Calibrated so an idle (no-upgrade) player falls
 * meaningfully behind within a few minutes.
 *
 * Formula (applied per tick):
 *   demand_new = demand_old * DEMAND_GROWTH_PER_S ^ (dtMs / 1000)
 */
export const DEMAND_GROWTH_PER_S = 1.0005;

/**
 * Starting Demand for era 1, in bps.
 * Chosen to match the era-1 starting Bandwidth so the player begins at
 * capacity and must immediately start upgrading to stay ahead.
 */
export const STARTING_DEMAND = 50;

/**
 * Starting Bandwidth contribution baked in at game start (bps).
 * Represents the "bare wire" you already have before any upgrades.
 * Should equal or slightly exceed STARTING_DEMAND so the player begins in
 * a healthy surplus state rather than immediately in deficit.
 */
export const STARTING_BANDWIDTH = 60;

// ---------------------------------------------------------------------------
// Congestion / deficit
// ---------------------------------------------------------------------------

/**
 * The efficiency floor that congestion sags toward on sustained deficit.
 * 0.70 means even in the worst persistent deficit you still carry 70% of
 * your Bandwidth (so there is always a revenue floor, preventing death spirals).
 */
export const CONGESTION_FLOOR = 0.7;

/**
 * Time window (milliseconds) over which a persistent deficit ramps
 * congestion efficiency from 1.0 down to CONGESTION_FLOOR.
 * 60 000 ms = 60 seconds of continuous deficit.
 *
 * Linear interpolation: efficiency = 1.0 - (1.0 - CONGESTION_FLOOR)
 *   × clamp(deficitMs / DEFICIT_RAMP_WINDOW_MS, 0, 1)
 */
export const DEFICIT_RAMP_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Upgrade cost growth (geometric scaling)
// ---------------------------------------------------------------------------

/**
 * Default cost-growth multiplier per level for era-1 upgrades.
 * Each subsequent purchase of the same upgrade costs this much more.
 * Range recommended by the design doc: ~1.07–1.15.
 *
 * Individual upgrades may override this with their own costGrowth field.
 */
export const DEFAULT_COST_GROWTH = 1.1;
