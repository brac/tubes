/**
 * layer-shader.ts — Layer 1, the Shader River (back, slowest).
 *
 * THE one-draw-object layer. It is a single full-screen Pixi v8 Mesh running a
 * custom fragment shader (river.frag). The "trickle -> torrent" illusion across
 * ~30 orders of game magnitude lives entirely in this shader's uniforms — we
 * NEVER add geometry to express "more" (rendering doc §1, §2 Layer 1, §6).
 *
 * Object cost: exactly ONE drawable, forever (SHADER_COUNT === 1).
 * Per-frame allocation: ZERO — update() only mutates existing uniform values.
 *
 * Pixi v8 pipeline notes (gotchas worth recording):
 *  - We use the WebGL path via `Shader.from({ gl: { vertex, fragment } })`.
 *    A `gpu` program is intentionally omitted; this project targets WebGL on
 *    mobile (rendering doc §0). If WebGPU is ever enabled it would need a WGSL
 *    twin — out of scope for Phase 5.
 *  - Uniforms must be declared up-front in a UniformGroup with explicit GLSL
 *    types ('f32', 'vec2<f32>', 'vec3<f32>'). Pixi reflects these into the GL
 *    program; you cannot add a uniform later, only mutate `.value`.
 *  - Geometry attribute name ('aPosition') must match the vertex shader. The
 *    quad is a unit triangle-strip in clip space; the vertex shader passes UV
 *    straight through, so resize only touches the uResolution uniform — the
 *    clip-space quad always fills the viewport regardless of canvas size.
 */

import { Geometry, Mesh, Shader } from 'pixi.js';
import type { Container } from 'pixi.js';

import type { Layer, RenderSignals } from './types.js';
import { shaderParams } from './emission.js';
import { SHADER_FLOW_MAX } from './config.js';

// Raw GLSL source pulled in at build time by Vite's `?raw` loader.
import fragmentSource from './shaders/river.frag?raw';

// ---------------------------------------------------------------------------
// Palette (Phase 5 fixed; Phase 6 swaps per era)
// ---------------------------------------------------------------------------

/**
 * River colors as linear-ish RGB triples in 0..1, derived from the cyan "flow"
 * and amber "warm" tokens (tokens.css). uColorA is the deep shadow current,
 * uColorB the bright crest. We bias the crest slightly toward warm so bright
 * veins pick up the dial-up CRT amber (rendering doc §8) rather than going pure
 * white.
 *
 * Approximate sRGB of the tokens:
 *   --color-flow-dim  oklch(52% 0.12 215) ≈ #1f6f8f  (deep cyan)
 *   --color-flow      oklch(72% 0.18 210) ≈ #36b6e6  (vivid cyan)
 *   --color-warm      oklch(74% 0.17 70)  ≈ #e0a64d  (CRT amber)
 * Crest = vivid cyan nudged toward amber for a warm hot-core.
 */
const COLOR_DEEP: readonly [number, number, number] = [0.12, 0.43, 0.56];
const COLOR_CREST: readonly [number, number, number] = [0.45, 0.78, 0.95];

// ---------------------------------------------------------------------------
// Uniform value caps (mirror shaderParams() output envelope)
// ---------------------------------------------------------------------------

/**
 * Burst can push flow above SHADER_FLOW_MAX (shaderParams allows up to ×1.3).
 * We normalize the flow uniform into a 0..1-ish band for the shader's internal
 * frequency math, so the shader stays well-behaved at the torrent end.
 */
const FLOW_UNIFORM_DIVISOR = SHADER_FLOW_MAX;

// ---------------------------------------------------------------------------
// Layer implementation
// ---------------------------------------------------------------------------

export class ShaderRiverLayer implements Layer {
  readonly view: Container;

  private readonly mesh: Mesh<Geometry, Shader>;
  private readonly shader: Shader;

  /** Monotonic animation clock in seconds; advanced by update(). */
  private timeSeconds = 0;

  constructor() {
    const geometry = buildFullQuadGeometry();
    this.shader = buildRiverShader();

    this.mesh = new Mesh<Geometry, Shader>({
      geometry,
      shader: this.shader,
    });

    // The mesh IS the view — keeping it as the Container avoids an extra
    // wrapper node (still exactly one drawable in the scene graph).
    this.view = this.mesh;
  }

  resize(width: number, height: number): void {
    // Clip-space quad already fills the viewport, so geometry is untouched.
    // We only feed the pixel size to the shader for the scanline period.
    const res = this.uniforms.uResolution as Float32Array;
    res[0] = width;
    res[1] = height;
  }

  update(dtMs: number, signals: RenderSignals): void {
    // Advance the animation clock. Clamp dt defensively so a backgrounded tab
    // returning with a huge delta doesn't jolt the flow (rendering doc §9).
    const dtSeconds = Math.min(dtMs, 100) / 1000;
    this.timeSeconds += dtSeconds;

    const params = shaderParams(signals);
    const u = this.uniforms;

    u.uTime = this.timeSeconds;
    // Normalize flow so the shader's frequency scaling stays stable even when
    // burst pushes flow past SHADER_FLOW_MAX.
    u.uFlow = params.flow / FLOW_UNIFORM_DIVISOR;
    u.uDensity = params.density;
    u.uBrightness = params.brightness;
    u.uSaturation = clamp01(signals.saturation);
  }

  destroy(): void {
    // Mesh.destroy with these flags releases the geometry + shader/GL program.
    this.mesh.destroy({ children: true });
  }

  /** Convenience accessor for the uniform record on the shader's group. */
  private get uniforms(): Record<string, number | Float32Array> {
    return this.shader.resources.riverUniforms.uniforms as Record<
      string,
      number | Float32Array
    >;
  }
}

// ---------------------------------------------------------------------------
// Construction helpers (private)
// ---------------------------------------------------------------------------

/**
 * buildFullQuadGeometry — a unit quad in CLIP SPACE as a triangle-strip.
 *
 * Positions are already in NDC (-1..1) so the vertex shader is a pass-through;
 * the quad fills the viewport at any canvas size with no resize-time geometry
 * rebuild. UVs are 0..1 with v flipped so (0,0) reads as top-left in the frag.
 */
function buildFullQuadGeometry(): Geometry {
  // x, y in clip space.
  const positions = new Float32Array([
    -1, -1, // bottom-left
    1, -1, // bottom-right
    -1, 1, // top-left
    1, 1, // top-right
  ]);

  // u, v — v flipped so top of screen is v=0 (matches frag's top-left origin).
  const uvs = new Float32Array([
    0, 1, // bottom-left
    1, 1, // bottom-right
    0, 0, // top-left
    1, 0, // top-right
  ]);

  return new Geometry({
    attributes: {
      aPosition: positions,
      aUV: uvs,
    },
    topology: 'triangle-strip',
  });
}

/**
 * buildRiverShader — the GL program + uniform group for the river.
 *
 * Uniform group is declared once with explicit types; update() mutates the
 * `.value`s in place each frame (no reallocation, no group rebuild).
 */
function buildRiverShader(): Shader {
  return Shader.from({
    gl: {
      vertex: VERTEX_SOURCE,
      fragment: fragmentSource,
    },
    resources: {
      riverUniforms: {
        uTime: { value: 0, type: 'f32' },
        uFlow: { value: 0, type: 'f32' },
        uDensity: { value: 0, type: 'f32' },
        uBrightness: { value: 0, type: 'f32' },
        uSaturation: { value: 1, type: 'f32' },
        uColorA: { value: new Float32Array(COLOR_DEEP), type: 'vec3<f32>' },
        uColorB: { value: new Float32Array(COLOR_CREST), type: 'vec3<f32>' },
        uResolution: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
      },
    },
  });
}

/**
 * Minimal pass-through vertex shader (GLSL ES 1.00 to match river.frag).
 *
 * aPosition is already clip-space NDC, so we assign it straight to gl_Position.
 * aUV is forwarded to the fragment shader via vUV. No matrices needed because
 * this layer always fills the whole viewport.
 */
const VERTEX_SOURCE = `
precision mediump float;

attribute vec2 aPosition;
attribute vec2 aUV;

varying vec2 vUV;

void main() {
  vUV = aUV;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
