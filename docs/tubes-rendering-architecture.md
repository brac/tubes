# Tubes — Rendering Architecture

**How to draw an ever-growing river of data packets — from a lonely dial-up trickle to a bajillion-packet fiber torrent — on a phone, without an asset pipeline.**

This document specifies the visual/rendering layer. Game systems are in `tubes-game-design.md`. Read the **Core Principle** section first; everything else follows from it.

---

## 0. Stack & Constraints

- **Renderer:** Pixi.js v8 (WebGL). Chosen for shader/filter support, mature sprite batching, and good mobile performance. (Dev is already familiar with Pixi from another project.)
- **Target floor:** mid-range phones. PWA-first. Must hold a smooth frame rate (target 60fps, acceptable floor 30fps) on a backgroundable mobile tab.
- **Asset budget:** ~zero. No sprite sheets, no animation frames. Visuals are procedural: shapes + tint + shaders + motion. A "packet" is a rounded rect with a glow. Eras are palettes + curve parameters.
- **Hard rule:** object counts are **capped and constant** regardless of in-game throughput. The simulation number can be 1e30; the number of drawn objects never exceeds the caps below.

---

## 1. Core Principle: representation, not enumeration

**You are drawing a *rate*, not a *count*.**

The single most important idea in this document. The game's "data carried" stat climbs across ~30 orders of magnitude. You **cannot and must not** draw one sprite per packet. Instead:

- The **number** lives in game state (a big-number value ticking up). It is never tied to object count.
- The **river** is a *visual representation of the current throughput rate*, not a literal rendering of packets. At 300 baud it shows a few crawling packets; at fiber it shows a dense blur — possibly the *same* few hundred objects, moving faster, denser-tinted, with the shader river cranked. Nobody counts them. Nobody can.

Everything below is in service of making the river *read as* "more" across the whole range while drawing a bounded, small number of things.

---

## 2. The Three Layers (back to front)

Parallax depth via three independently-scrolling layers. Each has a **hard object cap**. Each scrolls at a different speed for parallax (back = slowest, front = fastest).

```
┌─────────────────────────────────────────────┐
│  LAYER 3: HERO PACKETS   (front, fastest)     │  ← crisp, labeled, always present
│  LAYER 2: MID STREAM     (middle, medium)     │  ← recycled pool, saturates to blur
│  LAYER 1: SHADER RIVER   (back, slowest)      │  ← procedural, zero object cost
└─────────────────────────────────────────────┘
```

### Layer 1 — Shader River (back)
- **What:** a single full-width quad/mesh running a custom fragment shader. Scrolling, distorted flow (noise-driven) that reads as a current of light/data.
- **Object cost:** **one** draw object, forever. This is what carries the "bajillion packets" illusion at high throughput.
- **Driven by uniforms** (see Section 4): throughput → speed, density, brightness; era → palette.
- **Parallax:** slowest scroll.

### Layer 2 — Mid Stream (middle)
- **What:** a **fixed pool** of recycled sprites (rounded-rect packets, abstract, no labels). Emitted from the left, travel right, returned to the pool at the edge. Never allocated per packet — the pool is created once and reused.
- **Cap:** a few hundred (tune; start ~300). As throughput rises, increase **emission rate and speed** until the pool saturates and the individual sprites visually blur into a stream. Past saturation, throughput increases are expressed by the *shader* (Layer 1), not more sprites.
- **Parallax:** medium scroll.

### Layer 3 — Hero Packets (front)
- **What:** a **small pool** of crisp, **labeled** packets — the ones the eye can actually track and read.
- **Cap:** tiny (tune; start ~12–30). Always present, at every throughput level. Even when Layers 1–2 are a saturated blur, a handful of legible hero packets ride on top so there's always something to focus on.
- **Labels:** early eras show literal content (a byte/hex value, a letter, a tiny word). See Section 3.
- **Parallax:** fastest scroll.

> **Why this split works on a phone:** the expensive illusion (infinite scale) is on the *free* layer (shader). The legible detail is on the *tiny* layer (hero). The medium layer is bounded. Total drawn objects ≈ shader(1) + mid(≤~300) + hero(≤~30). Constant, phone-safe, scales to infinity.

---

## 3. Legibility curve: labeled → abstract as speed rises

Decision: **labeled early, abstract as speed rises — but never fully lose hero packets.**

- **Hero layer (Layer 3)** is where legibility lives. In **early eras / low throughput**, hero packets carry literal micro-content: a hex byte, a single character, a tiny word fragment — reinforcing "this is data." As throughput climbs, hero packet labels simplify (byte → abstract glyph → pure glowing capsule) but **hero packets never disappear** — a few crisp ones always ride on top, even in the fiber torrent.
- **Mid + shader layers** are abstract from the start — they're the bulk/flow, never labeled.

So legibility and scale never fight: they live on different layers. The front layer keeps a human-readable anchor; the back layers carry overwhelming volume.

---

## 4. Driving the visuals from game state

The renderer reads a few **normalized scalars** derived from game state each frame. It does **not** read raw big-numbers. The game layer computes these; the render layer consumes them.

Suggested signals (all roughly 0..1 or small bounded ranges):

| Signal | Source | Drives |
|---|---|---|
| `intensity` | log-normalized current throughput within the era's range | shader speed + density, mid-stream emission rate + speed |
| `saturation` | how close Bandwidth is to Demand (the gap) | river fullness; deficit → starved look |
| `eraPalette` | current era | colors of all three layers |
| `surge` | active demand surge (0/1 + magnitude) | brief brightness/turbulence spike |
| `burst` | active burst-tap (0/1) | temporary overclock shimmer |

**Key trick:** because throughput spans ~30 orders of magnitude but visuals only need to span "trickle → torrent," **log-normalize within the current era**. Each era re-bases the visual intensity range, so the river always has visible dynamic range to grow into within that era, then the era jump resets the visual baseline (new palette, new "floor"). This is how you get visible visual progress across the whole game without the river maxing out and staying maxed.

### The deficit / congestion look (free storytelling)
When `saturation` indicates a deficit (Demand > Bandwidth, per game-design doc):
- packets visibly **queue/back up** at the left intake edge,
- the river past the intake looks **starved** (thinner, dimmer, gappy),
- on recovery, the backlog visibly drains.

This makes the core tension *visible* with no UI — the player sees they're falling behind. Implement as: emission still happens at Demand rate at the intake, but throughput past the intake is clamped to Bandwidth, so a visible pile-up forms at the edge.

---

## 5. Pooling & lifecycle (the no-allocation rule)

- Pools (Layer 2 and Layer 3) are **pre-allocated once** at startup at their cap size.
- A packet is "emitted" by pulling an inactive sprite from the pool, positioning it at the intake, and marking it active. At the right edge it's deactivated and returned. **No `new` per packet at runtime.** This avoids GC hitches — critical for smooth mobile frame times.
- Emission **rate** (not pool size) encodes throughput, until saturation. Past saturation, rate is capped and the shader takes over expressing "more."
- Use Pixi's sprite batching: identical-texture packets batch into few draw calls. Keep packet visuals uniform (tint, not unique textures) so they batch.

---

## 6. Occlusion / scaling — solved by construction

The dev's instinct to think about occlusion is right, but the answer here is **"don't generate what you can't see"** rather than cull-after-the-fact:

- With **capped pools**, there is never more than the cap to draw — nothing to cull.
- With the **shader**, off-screen literally doesn't exist (it's a fragment function over visible pixels).
- So the scaling problem **dissolves**: object count is bounded by design, not by runtime culling. There is no "millions of packets" data structure to occlude.

The only real perf levers are: pool cap sizes, shader complexity, and overdraw (layered transparency). Tune those for the phone floor.

---

## 7. Parallax

- Three layers scroll horizontally at different speeds (back slowest → front fastest) to create depth.
- Optionally add subtle vertical drift or a slight perspective skew so the river feels like it has volume.
- Parallax speed can itself scale slightly with `intensity` so faster eras *feel* faster, but keep the front/back ratio constant so depth reads consistently.

---

## 8. Era visual regimes

Each era is a **palette + parameter set**, not new art:
- color ramp for all three layers,
- shader density/turbulence baseline,
- hero packet label style (literal content early → abstract late),
- optional accent (e.g. dial-up = warm CRT amber + scanline hint; fiber = cool cyan/white high-bloom).

Transition between eras: a brief animated re-tint / intensity swell rather than a hard cut. The river does **not** regress to an earlier era's look on prestige (see game-design doc — eras are permanent).

---

## 9. Performance checklist (mobile floor)

- [ ] Object counts capped and constant (shader=1, mid≤~300, hero≤~30); verify they never grow with throughput.
- [ ] Pools pre-allocated; zero per-packet allocation at runtime; watch for GC sawtooth in profiler.
- [ ] Packets share a texture/tint so they batch into minimal draw calls.
- [ ] Shader kept cheap (simple noise; avoid heavy per-pixel loops). Profile on a real mid-range phone, not just desktop.
- [ ] Watch **overdraw** from three transparent layers — the most likely mobile bottleneck. Consider reducing layer alpha/blur on low-end.
- [ ] Cap devicePixelRatio rendering on very high-DPI phones if fill-rate-bound.
- [ ] Pause/throttle the render loop on `visibilitychange` (backgrounded tab shouldn't burn battery; game logic uses offline calculation on return anyway).
- [ ] Provide a "reduce effects" toggle (lower caps, disable shader, flat colors) as an accessibility + low-end fallback.

---

## 10. Build order (rendering)

1. **Static three-layer scaffold:** three scrolling layers with placeholder rects, parallax working, no game hookup. Prove the depth reads.
2. **Pools:** Layer 2 + 3 pooling with emission-rate control wired to a debug slider (fake `intensity`).
3. **Shader river:** Layer 1 fragment shader, uniforms wired to the same debug slider. Prove trickle→torrent across the slider range.
4. **Game hookup:** replace the debug slider with real normalized signals from game state (Section 4).
5. **Deficit look:** intake pile-up + starved river on `saturation` deficit.
6. **Era palettes + hero labels:** the content/legibility curve and per-era regimes.
7. **Polish:** surge/burst shimmer, era-transition swells, reduce-effects toggle, mobile profiling pass.

> Build steps 1–3 against a **debug slider**, not the game. Decoupling "can I render trickle→torrent" from "is the game wired up" lets you nail the hard rendering risk in isolation. This is the riskiest part of the project — prototype it first and standalone.

---

## 11. Portfolio note

The rendering layer is the engineering showpiece here. The decoupling of simulation-number from object-count, the log-normalized-per-era intensity mapping, the shader-river-plus-bounded-pool hybrid, and the GC-free pooling are all concrete, explainable architectural decisions — exactly the kind of "I made deliberate choices" signal that distinguishes a portfolio piece from a tutorial clone. Worth a short write-up in the repo README explaining *why* representation-over-enumeration, with the object-count math.
