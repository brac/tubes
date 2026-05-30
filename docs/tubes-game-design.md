# Tubes — Game Design Document

**A PWA idle game about moving data across the internet, from a 300-baud modem to global backbone.**

This document specifies the game systems, economy, and progression. Rendering is covered in a separate document (`tubes-rendering-architecture.md`); this doc references the visual layer but does not specify it.

---

## 1. Concept

You operate a slice of the internet's plumbing. Data flows through your pipes; you earn **Revenue** per unit carried. The internet's **Demand** for data rises relentlessly — first as a smooth curve, then in big step-jumps as content evolves (text → images → video → 4K → VR → beyond). Your job is to keep **Bandwidth ≥ Demand**, upgrading your infrastructure to ride the wave. Periodically you tear it all down and **rebuild the backbone** (prestige), trading your current buildout for **Protocol**, a permanent currency that buys lasting multipliers.

The fantasy is *throughput*: watching a trickle of packets on a dial-up line grow into an overwhelming river of data on fiber. It is a factory/flow game wearing a networking costume.

**Platform:** PWA, phone-first. Must be fully playable with zero clicking. Must survive being backgrounded and closed.

**Title:** Tubes. **Currencies:** Revenue (spend), Protocol (prestige/permanent).

---

## 2. Core Loop

1. Data flows automatically through your pipes → earns **Revenue** over time.
2. Spend Revenue on **upgrades** that raise **Bandwidth** (carrying capacity / throughput).
3. **Demand** rises continuously and in era step-jumps; you chase it.
4. When you've built enough to clear an **era gate**, you advance to the next **Era** (permanent, never lost).
5. When growth slows, **rebuild the backbone** (prestige): reset Revenue and most buildout, gain **Protocol**, buy permanent multipliers, climb faster.

The spine is **pure idle**: check in, see numbers climbed, buy upgrades, leave. Optional active mechanics (Section 7) reward presence but are never required.

---

## 3. The Two-Resource Tension: Bandwidth vs. Demand

This is the heart of the game. Two numbers in constant tension.

### Bandwidth
Total carrying capacity, in bits/sec (scaling to absurd units). Raised by upgrades and multipliers. This is what the player grows.

### Demand
How much data the internet wants to push through *right now*, same units. The player does **not** control this; it rises on its own. Two components:

- **Smooth auto-rise:** Demand grows continuously over time on a gentle exponential/compounding curve. There is always slow upward pressure.
- **Era step-jumps:** On entering a new Era, Demand takes a large discrete jump (new content type = much more data). This is the "oh no, I need to scale" moment that motivates the next buildout.

### The gap (Bandwidth − Demand) drives everything

| State | Condition | Effect |
|---|---|---|
| **Surplus** | Bandwidth > Demand | Carry 100% of demand. Full Revenue. River looks healthy and flowing. |
| **At capacity** | Bandwidth ≈ Demand | Carrying all demand, no headroom. River looks dense, near-saturated. |
| **Deficit** | Bandwidth < Demand | Carry only up to Bandwidth. **Unmet demand = lost Revenue** (opportunity cost, not penalty). River visibly starves/congests: packets queue at the intake edge. |

**Three timescales of consequence for a deficit:**

1. **Moment-to-moment — lost income only.** You earn on what you *carry*, capped at Bandwidth. Unmet demand is just Revenue you're not collecting. **No punishment for idling** — critical for a check-in-twice-a-day PWA. This is also free visual storytelling: a deficit *looks* like a starved/backed-up river (see rendering doc), so the player feels the gap without reading a number.
2. **Medium-term — soft congestion.** If a deficit persists for a sustained window (e.g. >60s of real time at a meaningful gap), carrying *efficiency* sags toward a floor (e.g. down to 70%, never to zero). Fully recoverable the moment Bandwidth catches up. This nudges investment without ever creating a death spiral. **Never brick the player.**
3. **Era boundary — hard gate.** To advance an Era you must sustain **Bandwidth ≥ current Demand** for a threshold window (e.g. 30s). The era jump is *earned*, not bought. This is the natural home of the Protocol economy (better multipliers make gates clearable).

> **Design rule:** the player is never punished for being away, always gently pulled toward upgrading, and the big moments (era gates) feel like accomplishments.

---

## 4. Eras (the permanent ratchet)

Eras are the forward march of internet history. **Eras never regress** — not on prestige, not ever. Each Era is simultaneously:

- a **demand step-jump** (new content type wants far more data),
- a **visual regime change** (new palette, river density, packet style — see rendering doc),
- a new band of **upgrades** unlocked.

**Provisional era list** (content type = the demand driver):

| # | Era | Content driving demand | Flavor of within-era upgrades |
|---|---|---|---|
| 1 | Dial-up | Text, email | Cleaner lines, dedicated line, ISDN, 56k |
| 2 | Broadband | Images, early web | DSL, cable, ADSL2+ |
| 3 | Streaming | Video | Fiber-to-node, DOCSIS, CDN nodes |
| 4 | HD/4K | High-res video | FTTH, peering deals, edge caching |
| 5 | Immersive | VR / volumetric | Multi-gigabit, dark fiber, regional backbone |
| 6 | Global mesh | Everything, everywhere | Undersea cable, satellite constellation |
| 7+ | (post-game) | Procedural / abstract | Quantum links, etc. — see Section 6 |

Within each era: **many small, cheap, frequent upgrades** (incremental multipliers — the dopamine drip). Between eras: **one big gated leap**.

> **IMPORTANT — eras vs. prestige (do not conflate):** Eras are the *permanent forward axis*. Prestige (Section 5) is a *repeatable reset for multipliers*. A prestige does **NOT** send the player back to an earlier era or regress the river's visual tier. Prestige resets *scale* (Revenue + buildout); it preserves *era*. The river never visually regresses to dial-up after you've reached, say, the Streaming era.

---

## 5. Prestige: "Rebuild the Backbone"

Classic prestige loop, reconciled with the never-regress era rule.

- **Trigger:** player-initiated at any time (with a sensible minimum threshold so it's not spammed).
- **What you lose:** current **Revenue** balance and most/all of your **purchased buildout** (the within-era upgrades, the per-run Bandwidth).
- **What you keep:** **Era progress** (permanent — you do not drop eras), unlocked content tier, and all **Protocol**.
- **What you gain:** **Protocol**, scaled to how far you pushed this run (e.g. a function of peak Bandwidth or total Revenue earned this run).

**Protocol spends on permanent multipliers** — a small tree of upgrades that persist across all future rebuilds:
- global Revenue multiplier,
- global Bandwidth multiplier,
- cheaper within-era upgrades,
- faster offline earning,
- (later) starting boosts so each rebuild ramps faster.

**Mental model:** Eras = a ratchet that only turns forward. Prestige = a spring you compress (sacrifice a run) and release (permanent multipliers) to climb the *next* stretch faster. The "rebuild the backbone" framing fits the theme: you're not going back in time, you're re-laying infrastructure at greater scale.

---

## 6. Endgame — Soft-Infinite

There **is** an ending: reaching the **Global mesh** era (or a defined final milestone) triggers a real "you've connected the world" payoff screen — credits, a stat summary, an achievement. This gives the "history of the internet" arc a satisfying close and gives reviewers/portfolio-viewers a finish line.

**After** the ending, the game keeps scaling: post-game procedural eras (quantum, interplanetary relay, abstract "Tier N" links) with continued Protocol scaling, so committed idle players never hit a wall. The ending is a milestone, not a hard stop.

---

## 7. Active Mechanics (all optional)

The default loop is 100% idle. These reward presence without punishing absence. **None may gate progression.**

- **Burst tap:** tap to temporarily overclock throughput (e.g. +Bandwidth for 10s, then a cooldown). Pure upside when present; irrelevant when away.
- **Demand surges:** occasional themed events (a viral video, a big software release, a breaking-news spike) briefly spike Demand *and* potential Revenue. Tap to "route" the surge for a bonus window. Ignore it → no harm, you just don't collect the bonus.
- **(v2, do not build at launch) Bandwidth allocation:** actively assign capacity across concurrent demand types (text/image/video). Great depth mechanic but raises the active floor too high for launch — note as a future layer only.

> **Design rule:** if a phone is in someone's pocket, the game must play itself correctly. Active mechanics are seasoning, never the meal.

---

## 8. Economy & Numbers (starting guidance, to be tuned)

This is an idle game — expect to tune curves heavily in playtesting. Starting principles:

- **Revenue rate** = (data carried per tick) × (Revenue per unit) × (Protocol & upgrade multipliers). Data carried = min(Bandwidth, Demand) × congestion-efficiency.
- **Upgrade costs** scale geometrically (classic idle: each purchase of an upgrade multiplies its next cost by ~1.07–1.15). Tune per-upgrade.
- **Demand auto-rise:** gentle compounding; calibrate so a *non*-upgrading player falls behind in minutes, an attentive player stays ahead.
- **Era demand jump:** large multiple of current demand (e.g. 5–20×) so it clearly demands a new buildout.
- **Protocol gain on prestige:** sub-linear in run performance (e.g. proportional to sqrt or log of peak Revenue) so early prestiges are quick and later ones meaningful.
- **Number formatting:** standard idle big-number notation (K, M, B, T, then scientific or named tiers). Build a robust large-number formatter early — naive floats break past ~1e15; consider a big-number representation (mantissa + exponent) from the start.

> **Recommendation:** model the economy in a throwaway spreadsheet before committing curves to code. Get the *shape* (time-to-first-prestige, prestiges-per-era) right on paper.

---

## 9. Persistence & Offline Progression

Covered in detail in the rendering/architecture doc, summarized here for game logic:

- **Save store:** IndexedDB (structured, robust, room to grow vs. localStorage).
- **Offline earnings:** on load, compute elapsed real time since last save and award offline Revenue based on the *rate at save time* (optionally capped, e.g. 8–12h, and/or at a reduced %). This is the "what happened while you were gone" calculation — a clean, self-contained piece of logic and a nice engineering showpiece.
- **Save cadence:** autosave on a short interval and on `visibilitychange`/`pagehide` (phones kill backgrounded tabs without warning).
- **Tamper note:** local saves are trivially editable. For a single-player idle game that's acceptable; don't waste effort on anti-cheat. If a leaderboard is ever added, that's a server problem, out of scope here.

---

## 10. Build Phasing (suggested)

1. **Numbers-first prototype:** core loop with placeholder UI — Bandwidth, Demand, Revenue, one era, buy-an-upgrade, the deficit/surplus logic. No fancy rendering. Prove the loop is *fun* as pure numbers first.
2. **Prestige + Protocol:** add rebuild, Protocol tree, second era + era gate.
3. **Persistence:** IndexedDB saves + offline progression.
4. **Rendering:** wire in the 3-layer visual system (separate doc). This is the "make it sing" phase.
5. **Eras content:** flesh out all eras, demand jumps, palettes.
6. **Active mechanics + endgame + post-game scaling.**
7. **PWA polish:** manifest, service worker, install prompt, icon.

> Build the *fun* (loop + prestige) before the *beauty* (rendering). The rendering is the portfolio showpiece, but a pretty river over a boring loop is still boring.

---

## 11. Open Questions / To Tune

- Exact demand curve constants and era multipliers (playtest).
- Protocol tree size and multiplier values.
- Whether congestion efficiency floor is 70% or elsewhere.
- Offline earnings cap and percentage.
- Minimum prestige threshold.
- Final-era milestone definition for the "ending."
