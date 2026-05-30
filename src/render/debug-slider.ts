/**
 * debug-slider.ts — dev-only DOM control panel for the River Lab (Phase 5).
 *
 * Renders four range sliders (intensity, saturation, surge, burst, each 0..1)
 * plus a live readout used to VISUALLY VERIFY the rendering caps hold across the
 * whole intensity range:
 *
 *   - FPS                 (smoothed, so we can confirm 60fps desktop / ≥30 phone)
 *   - active mid count    (must never exceed MID_CAP)
 *   - active hero count   (must never exceed HERO_CAP)
 *   - shader draws: 1     (constant by construction — SHADER_COUNT)
 *
 * This is a STANDALONE harness control. It builds raw DOM (no framework) so the
 * lab page has zero extra dependencies. It is NOT shipped with the game build —
 * only the river-lab.html entry imports it.
 *
 * IMMUTABILITY: getSignals() returns a fresh object each call; the panel never
 * hands out a mutable reference to its internal state.
 */

import { MID_CAP, HERO_CAP, SHADER_COUNT } from './config.js';
import type { RenderSignals } from './types.js';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Live counts the panel displays each frame; supplied by the lab loop. */
export interface DebugReadout {
  /** Smoothed frames per second. */
  fps: number;
  /** Currently active mid-stream sprites (expected ≤ MID_CAP). */
  midActive: number;
  /** Currently active hero sprites (expected ≤ HERO_CAP). */
  heroActive: number;
}

export interface DebugPanel {
  /** The root DOM node — append to document.body. */
  readonly element: HTMLElement;

  /** Current slider values as a fresh RenderSignals object (0..1 each). */
  getSignals(): RenderSignals;

  /** Push live counts into the readout (called once per frame by the lab). */
  setReadout(readout: DebugReadout): void;

  /** Remove the panel from the DOM and drop listeners. */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Slider definitions
// ---------------------------------------------------------------------------

interface SliderDef {
  key: keyof RenderSignals;
  label: string;
  /** Initial 0..1 value. */
  initial: number;
}

const SLIDERS: readonly SliderDef[] = [
  { key: 'intensity', label: 'Intensity', initial: 0.25 },
  { key: 'saturation', label: 'Saturation', initial: 1.0 },
  { key: 'surge', label: 'Surge', initial: 0.0 },
  { key: 'burst', label: 'Burst', initial: 0.0 },
];

const SLIDER_STEP = 0.001;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * createDebugPanel — build the slider + readout panel.
 *
 * The caller appends `.element` to the document and, each frame, calls
 * getSignals() to drive the river and setReadout() to display live counts.
 */
export function createDebugPanel(): DebugPanel {
  // Internal slider state (0..1). Mutated by input events only.
  const values: Record<keyof RenderSignals, number> = {
    intensity: 0,
    saturation: 0,
    surge: 0,
    burst: 0,
  };

  const valueLabels = new Map<keyof RenderSignals, HTMLElement>();
  const inputs: HTMLInputElement[] = [];

  const root = document.createElement('section');
  root.setAttribute('aria-label', 'River debug controls');
  applyPanelStyle(root);

  // ── Title ────────────────────────────────────────────────────────────────
  const title = document.createElement('h2');
  title.textContent = 'River Controls';
  applyTitleStyle(title);
  root.appendChild(title);

  // ── Sliders ────────────────────────────────────────────────────────────
  for (const def of SLIDERS) {
    values[def.key] = def.initial;

    const row = document.createElement('div');
    applyRowStyle(row);

    const labelEl = document.createElement('label');
    labelEl.textContent = def.label;
    applyLabelStyle(labelEl);

    const valueEl = document.createElement('span');
    valueEl.textContent = def.initial.toFixed(2);
    applyValueStyle(valueEl);
    valueLabels.set(def.key, valueEl);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = String(SLIDER_STEP);
    input.value = String(def.initial);
    input.setAttribute('aria-label', def.label);
    applySliderStyle(input);

    input.addEventListener('input', () => {
      const v = clamp01(Number(input.value));
      values[def.key] = v;
      valueEl.textContent = v.toFixed(2);
    });

    inputs.push(input);

    const head = document.createElement('div');
    applyRowHeadStyle(head);
    head.appendChild(labelEl);
    head.appendChild(valueEl);

    row.appendChild(head);
    row.appendChild(input);
    root.appendChild(row);
  }

  // ── Readout ───────────────────────────────────────────────────────────
  const readoutEl = document.createElement('div');
  applyReadoutStyle(readoutEl);
  root.appendChild(readoutEl);

  const fpsLine = makeReadoutLine();
  const midLine = makeReadoutLine();
  const heroLine = makeReadoutLine();
  const shaderLine = makeReadoutLine();
  readoutEl.append(fpsLine, midLine, heroLine, shaderLine);

  // Shader draw count is constant by construction — render it once.
  shaderLine.textContent = `shader draws: ${SHADER_COUNT}`;

  // ── Public methods ───────────────────────────────────────────────────────

  function getSignals(): RenderSignals {
    return {
      intensity: values.intensity,
      saturation: values.saturation,
      surge: values.surge,
      burst: values.burst,
    };
  }

  function setReadout(readout: DebugReadout): void {
    fpsLine.textContent = `fps: ${Math.round(readout.fps)}`;
    fpsLine.style.color = fpsColor(readout.fps);

    midLine.textContent = `mid active: ${readout.midActive} / ${MID_CAP}`;
    midLine.style.color = capColor(readout.midActive, MID_CAP);

    heroLine.textContent = `hero active: ${readout.heroActive} / ${HERO_CAP}`;
    heroLine.style.color = capColor(readout.heroActive, HERO_CAP);
  }

  function destroy(): void {
    root.remove();
  }

  return { element: root, getSignals, setReadout, destroy };
}

// ---------------------------------------------------------------------------
// Style helpers (kept inline so the lab needs no extra CSS file)
// ---------------------------------------------------------------------------
//
// Colors mirror tokens.css: deep navy surface, cyan flow accent, amber warm,
// JetBrains Mono for the readout. The panel reads as part of the product, not a
// raw browser default (design-quality rule: intentional hover/focus states).

const FONT_MONO =
  '"JetBrains Mono", "Fira Code", ui-monospace, monospace';

function applyPanelStyle(el: HTMLElement): void {
  Object.assign(el.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '40',
    width: '220px',
    padding: '14px 16px',
    background: 'oklch(12% 0.025 240 / 0.92)',
    border: '1px solid oklch(32% 0.06 240)',
    borderRadius: '14px',
    backdropFilter: 'blur(8px)',
    boxShadow: '0 8px 32px oklch(0% 0 0 / 0.6)',
    color: 'oklch(92% 0.01 240)',
    font: `400 12px/1.4 ${FONT_MONO}`,
    userSelect: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
}

function applyTitleStyle(el: HTMLElement): void {
  Object.assign(el.style, {
    margin: '0 0 12px',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'oklch(72% 0.18 210)', // --color-flow
  } satisfies Partial<CSSStyleDeclaration>);
}

function applyRowStyle(el: HTMLElement): void {
  Object.assign(el.style, {
    marginBottom: '10px',
  } satisfies Partial<CSSStyleDeclaration>);
}

function applyRowHeadStyle(el: HTMLElement): void {
  Object.assign(el.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: '4px',
  } satisfies Partial<CSSStyleDeclaration>);
}

function applyLabelStyle(el: HTMLElement): void {
  Object.assign(el.style, {
    fontSize: '11px',
    color: 'oklch(60% 0.015 240)', // --color-text-dim
  } satisfies Partial<CSSStyleDeclaration>);
}

function applyValueStyle(el: HTMLElement): void {
  Object.assign(el.style, {
    fontSize: '11px',
    fontVariantNumeric: 'tabular-nums',
    color: 'oklch(82% 0.20 205)', // --color-flow-bright
  } satisfies Partial<CSSStyleDeclaration>);
}

function applySliderStyle(el: HTMLElement): void {
  Object.assign(el.style, {
    width: '100%',
    height: '4px',
    cursor: 'pointer',
    accentColor: 'oklch(72% 0.18 210)', // cyan thumb/track via native accent
  } satisfies Partial<CSSStyleDeclaration>);
}

function applyReadoutStyle(el: HTMLElement): void {
  Object.assign(el.style, {
    marginTop: '14px',
    paddingTop: '12px',
    borderTop: '1px solid oklch(22% 0.04 240)',
    display: 'grid',
    gap: '4px',
    fontSize: '11px',
    fontVariantNumeric: 'tabular-nums',
  } satisfies Partial<CSSStyleDeclaration>);
}

function makeReadoutLine(): HTMLElement {
  const el = document.createElement('div');
  el.style.color = 'oklch(92% 0.01 240)';
  return el;
}

// ---------------------------------------------------------------------------
// Status colors (verification at a glance)
// ---------------------------------------------------------------------------

/** Green ≥55, amber ≥30, red below — matches the doc's 60/30 fps targets. */
function fpsColor(fps: number): string {
  if (fps >= 55) return 'oklch(72% 0.18 145)'; // --color-surplus (green)
  if (fps >= 30) return 'oklch(74% 0.17 70)'; //  --color-warm (amber)
  return 'oklch(65% 0.20 25)'; //                 --color-deficit (red)
}

/**
 * Amber when a pool is saturated (active === cap). This is EXPECTED at high
 * intensity (the cap holding is the whole point) — amber flags "at the cap,
 * verify it never goes over", not an error.
 */
function capColor(active: number, cap: number): string {
  return active >= cap
    ? 'oklch(74% 0.17 70)' // --color-warm — saturated (expected at torrent)
    : 'oklch(92% 0.01 240)'; // --color-text — normal
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
