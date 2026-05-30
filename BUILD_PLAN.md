# Tubes — Build Plan

## Context

`Tubes` is a PWA idle game about moving data across the internet, from a 300-baud
modem to a global backbone. The repo currently holds **only two design docs**
(`docs/tubes-game-design.md`, `docs/tubes-rendering-architecture.md`) and no code.

This plan turns those docs into a sequential, executable build order. We follow
the docs' **fun-first** philosophy: prove the core loop is fun as pure numbers
before investing in the rendering showpiece, but de-risk rendering by building it
**standalone against a debug slider** (per the rendering doc) rather than bolted
to the game.

### Locked decisions
- **Stack:** Vite + TypeScript, Pixi.js v8 (WebGL), **vanilla TS DOM** HUD over the canvas.
- **Big numbers:** `break_infinity.js` (`Decimal`) — wrapped behind our own `lib/bignum.ts`.
- **Persistence:** IndexedDB (via `idb`).
- **Deploy:** Vercel, wired up **early** (right after the numbers prototype) so there's a live URL for real-phone testing throughout.
- **Phasing:** docs' order — loop → prestige → persistence → rendering → eras → active/endgame → PWA polish.

### Conventions
- Organize by feature/surface, not file type. Files 200–400 lines typical, 800 max.
- Immutable state updates: reducers return new state, never mutate.
- Fixed-timestep simulation decoupled from render frame rate (deterministic ticks).
- Renderer consumes **normalized scalars** only (never raw big-numbers).
- Object counts **capped and constant** regardless of throughput (shader=1, mid≤~300, hero≤~30).
- Tests (Vitest) for all pure logic: bignum, format, economy, demand, upgrades, prestige, offline. Target 80%+ on logic modules.

---

## Phase 0 — Scaffold & tooling

Goal: a running Vite + TS + Pixi dev server with lint/format/test wired.

- `npm init`; add Vite, TypeScript, `pixi.js`, `break_infinity.js`, `idb`, Vitest, ESLint, Prettier, stylelint.
- `vite.config.ts`, `tsconfig.json` (strict), `index.html` (mobile viewport, no-zoom), base CSS tokens in `src/styles/tokens.css` + `global.css`.
- Pixi app bootstrap in `src/main.ts` rendering a blank stage that resizes to viewport; cap `devicePixelRatio`.
- Scripts: `dev`, `build`, `preview`, `test`, `lint`, `format`.

**Verify:** `npm run dev` serves a blank full-viewport Pixi canvas on desktop + phone (LAN). `npm run build` succeeds. `npm test` runs (zero tests OK).

---

## Phase 1 — Numbers-first prototype (the core loop)

Goal: prove the Bandwidth-vs-Demand loop is fun with placeholder UI, **one era, no rendering**.

Files:
- `src/lib/bignum.ts` — thin wrapper over `Decimal` (add/mul/cmp/pow, `D(x)` helper).
- `src/lib/format.ts` — idle big-number formatting (K, M, B, T, then named/scientific).
- `src/game/state.ts` — `GameState` type + `initialState` (revenue, bandwidth, demand, era=1, upgrade levels).
- `src/game/eras.ts` — era table (start with era 1 = Dial-up).
- `src/game/upgrades.ts` — era-1 upgrades; geometric cost scaling (`cost = base * growth^level`).
- `src/game/economy.ts` — `dataCarried = min(bandwidth, demand) * congestionEfficiency`; `revenueRate`; bandwidth from upgrades.
- `src/game/demand.ts` — smooth compounding auto-rise.
- `src/game/tick.ts` — fixed-timestep loop (e.g. 100ms logic step), accumulates revenue, advances demand.
- `src/ui/hud.ts` + `upgrades-panel.ts` + `hud.css` — text readouts (Revenue, Bandwidth, Demand, surplus/deficit state) and buy buttons.

Mechanics from the design doc: surplus/at-capacity/deficit states; **lost income only** moment-to-moment (no idle punishment); medium-term soft congestion efficiency sagging to a floor (~70%) after sustained deficit, fully recoverable.

**Verify:** Vitest unit tests for `bignum`, `format`, `economy`, `demand`, `upgrades` (AAA, cost-curve + deficit-clamp cases). Manually: numbers climb, buying upgrades raises bandwidth, demand overtakes an idle player in minutes, deficit shows as lost revenue. Tune curve constants until the *shape* feels right.

---

## Phase 2 — Deploy early (Vercel + minimal PWA shell)

Goal: a live URL to test on a real phone for the rest of development.

- Minimal `public/manifest.webmanifest` + placeholder icons; register a basic service worker (offline app-shell cache only — full PWA polish deferred to Phase 9).
- Deploy via Vercel (`vercel:deploy` skill / Vercel MCP); confirm preview + production URLs.
- Sanity-check the loop runs on an actual phone.

**Verify:** production URL loads the prototype on a phone; installable to home screen; works offline (app shell).

---

## Phase 3 — Prestige + Protocol + era gate

Goal: the repeatable reset loop and a second era.

Files:
- `src/game/prestige.ts` — "Rebuild the backbone": reset Revenue + buildout, **keep era + Protocol**; award Protocol sub-linear in run performance (sqrt/log of peak). Minimum prestige threshold.
- `src/game/protocol.ts` — small permanent-multiplier tree (global revenue ×, global bandwidth ×, cheaper upgrades, faster offline).
- `src/game/eras.ts` — add era 2 (Broadband) + **era gate**: sustain Bandwidth ≥ Demand for a threshold window (~30s) to advance; demand step-jump on entry. **Eras never regress** (not on prestige).
- `src/game/demand.ts` — add era step-jump (large multiple, 5–20×).
- `src/ui/prestige-panel.ts` — rebuild button (shows Protocol payout preview) + Protocol tree UI; era-gate progress indicator.

**Verify:** unit tests for prestige payout, gate-window logic, era jump, protocol multipliers applied. Manually: a full run → gate clear → era 2 → prestige → faster re-climb; confirm era never drops on prestige.

---

## Phase 4 — Persistence & offline progression

Goal: survive close/background; reward time away.

Files:
- `src/persistence/schema.ts` — versioned save shape + migration hook.
- `src/persistence/store.ts` — IndexedDB save/load (via `idb`); serialize `Decimal` values safely.
- `src/game/offline.ts` — on load, compute elapsed real time since last save, award offline revenue at *rate at save time* (capped ~8–12h, optional reduced %).
- Wire autosave: short interval + `visibilitychange`/`pagehide`.

**Verify:** unit tests for offline-earnings math (elapsed→revenue, cap, reduced %) and save round-trip incl. Decimal serialization + a migration case. Manually: close tab, reopen later → "while you were away" gain; force-kill backgrounded phone tab → state restored.

---

## Phase 5 — Rendering prototype (standalone, debug slider)

Goal: de-risk the river in isolation — **no game hookup**. Drive everything from a fake `intensity` slider (rendering doc steps 1–3). This is the riskiest part; prove trickle→torrent first.

Files:
- `src/render/pool.ts` — generic pre-allocated sprite pool (no `new` per packet).
- `src/render/layer-mid.ts` — Layer 2: ~300-cap recycled rounded-rect packets; emission **rate + speed** encode intensity, saturate to blur.
- `src/render/layer-hero.ts` — Layer 3: tiny pool (~12–30) of crisp packets, always present.
- `src/render/shaders/river.frag` + `layer-shader.ts` — Layer 1: single full-width quad, noise-driven flow; uniforms for speed/density/brightness.
- `src/render/river.ts` — composes the three layers with parallax (back slowest → front fastest).
- `src/render/debug-slider.ts` — dev-only harness with sliders for `intensity` (+ later `saturation`, `surge`, `burst`).

**Verify:** object counts stay constant (shader=1, mid≤cap, hero≤cap) across full slider range — confirm in profiler; zero per-packet allocation (no GC sawtooth); slider sweep reads convincingly as trickle→torrent at 60fps desktop / ≥30fps phone.

---

## Phase 6 — Game hookup + deficit look

Goal: replace the debug slider with real signals; make the core tension visible.

Files:
- `src/game/signals.ts` — derive normalized scalars from game state each frame: `intensity` (log-normalized throughput **within current era**), `saturation` (Bandwidth-vs-Demand gap), `eraPalette`, `surge`, `burst`.
- `src/render/river.ts` — consume signals; **log-normalize per era** so the river always has dynamic range to grow into, re-basing on era jump.
- Deficit/congestion look: emit at Demand rate at the intake but clamp throughput past the intake to Bandwidth → visible pile-up at the left edge; starved/dim river downstream; backlog drains on recovery.

**Verify:** entering a new era visibly re-bases the river (new floor, doesn't stay maxed); a deficit *looks* starved/backed-up with no UI; recovery drains the backlog. Phone perf still ≥30fps.

---

## Phase 7 — Eras content & visual regimes

Goal: flesh out the full era ladder.

- `src/game/eras.ts` — all eras through Global mesh (Streaming, HD/4K, Immersive, Global mesh) with demand jumps + per-era upgrade bands.
- `src/render/river.ts` / palette module — per-era palette + shader density/turbulence baseline; hero-label legibility curve (literal hex/char/word early → abstract glyph → pure capsule late, **never fully gone**); animated re-tint/intensity swell on era transition (no hard cut, **no regression** on prestige).

**Verify:** play through all eras; each era reads as a distinct visual regime; legibility curve behaves; transitions are smooth swells.

---

## Phase 8 — Active mechanics, endgame, post-game

Goal: optional seasoning + a real finish line. **Nothing here may gate progression.**

- `src/game/` — Burst tap (temporary overclock + cooldown); Demand surges (themed events spiking Demand + Revenue; tap to route for a bonus window, ignorable with no harm). Wire `surge`/`burst` render signals.
- Endgame: reaching Global mesh triggers a "you've connected the world" payoff (credits + stat summary + achievement).
- Post-game: procedural eras (quantum/interplanetary/Tier-N) with continued Protocol scaling — soft-infinite, no wall.

**Verify:** burst/surge are pure upside when present, irrelevant when away (no progression gating); ending fires at Global mesh; post-game keeps scaling.

---

## Phase 9 — PWA polish & mobile profiling

Goal: ship-quality phone-first PWA.

- Full manifest, real icon set, install prompt, robust service worker (per docs' persistence guidance).
- Render loop pause/throttle on `visibilitychange` (battery); offline calc handles the gap on return.
- "Reduce effects" toggle (lower caps / disable shader / flat colors) for low-end + accessibility.
- Mobile profiling pass: cap DPR if fill-rate-bound, watch overdraw from the three transparent layers, tune caps to the phone floor.
- README write-up: representation-over-enumeration + object-count math (the portfolio note).

**Verify:** Lighthouse PWA + perf pass; installable; smooth on a real mid-range phone; reduce-effects works; CWV within web-rules budgets (microsite JS budget where feasible).

---

## Cross-cutting verification

- **Unit/logic (Vitest):** bignum, format, economy, demand, upgrades, prestige, protocol, offline, save round-trip/migration — 80%+ on logic modules.
- **Render:** profiler confirms constant object counts + no GC sawtooth across full range.
- **E2E/manual:** real-phone check each phase from Phase 2 onward via the live Vercel URL; visual regression on key breakpoints (320/375/768/1024/1440) for the HUD in later phases.
- **Idle invariants:** never punished for being away; deficit = lost income only; eras never regress.
