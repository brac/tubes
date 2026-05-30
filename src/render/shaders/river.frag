// river.frag — Layer 1 "Shader River" fragment shader (Tubes, Phase 5)
//
// ONE full-width quad runs this shader. It is the entire back layer: a
// noise-driven flowing current of light reading LEFT -> RIGHT. The "infinite
// scale" illusion lives here — higher throughput cranks these uniforms; it
// NEVER adds geometry. (Rendering doc §1, §2 Layer 1.)
//
// COST DISCIPLINE (rendering doc §9): cheap value noise, at most 2 octaves,
// no per-pixel loops, no texture fetches. This must hold 60fps on a mid-range
// phone, so every line here is intentionally inexpensive.
//
// Pixi v8 / WebGL note: this is a GLSL ES 1.00 fragment shader (precision +
// `varying` + `gl_FragColor`) paired with the matching vertex shader built in
// layer-shader.ts. The `vUV` varying is 0..1 across the quad.

precision mediump float;

// UV across the quad: (0,0) top-left -> (1,1) bottom-right. Flow runs along x.
varying vec2 vUV;

// ── Uniforms (set every frame from shaderParams() + raw signals) ──────────────
uniform float uTime;        // seconds, monotonically increasing animation clock
uniform float uFlow;        // flow speed  (maps SHADER_FLOW_* range, may exceed 1 on burst)
uniform float uDensity;     // ripple frequency / "fullness" (SHADER_DENSITY_* range)
uniform float uBrightness;  // overall glow level (SHADER_BRIGHTNESS_* range, up to ~1.2)
uniform float uSaturation;  // river fullness 0..1 — thins/dims the band on deficit
uniform vec3  uColorA;      // deep / shadow color of the current (linear-ish RGB 0..1)
uniform vec3  uColorB;      // bright / crest color of the current (linear-ish RGB 0..1)
uniform vec2  uResolution;  // quad pixel size — used only for a subtle scanline hint

// ── Cheap hash + value noise ─────────────────────────────────────────────────
// 2D hash → 0..1. Classic sin-dot hash: one transcendental, no textures.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Value noise with smooth (smoothstep) interpolation. 4 hash taps per call.
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Smoothstep weights — cheaper visually than true cubic, plenty for a river.
  vec2 u = f * f * (3.0 - 2.0 * f);

  float a = hash(i + vec2(0.0, 0.0));
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  // Bilinear blend of the four lattice corners.
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Two-octave fbm. Capped at TWO octaves on purpose (mobile budget) — the second
// octave just breaks up the banding of the first; more would cost fill rate.
float fbm2(vec2 p) {
  float v = valueNoise(p) * 0.65;
  v += valueNoise(p * 2.17 + 19.3) * 0.35; // offset so octaves don't align
  return v;
}

void main() {
  vec2 uv = vUV;

  // ── Scroll the noise field LEFT -> RIGHT ───────────────────────────────────
  // Subtracting on x makes the pattern travel toward +x (the intake->edge flow).
  // Density scales horizontal frequency so a "fuller" river has finer structure.
  float scroll = uTime * uFlow;
  vec2 flowUV = vec2(
    uv.x * mix(2.5, 7.0, uDensity) - scroll * 1.6,
    uv.y * 3.0
  );

  // Primary flowing current.
  float current = fbm2(flowUV);

  // A second, slower, counter-drifting layer adds depth/turbulence without a
  // third octave. Cheap: one extra fbm2 call.
  float deep = fbm2(flowUV * 0.5 + vec2(scroll * 0.5, uTime * 0.05));
  float field = mix(current, deep, 0.4);

  // ── Vertical river band shaping ────────────────────────────────────────────
  // The light concentrates in a horizontal band down the middle and falls off
  // toward top/bottom so the quad reads as a *river*, not a flat noise wash.
  // Lower saturation narrows + softens the band (the "starved river" hint, §4).
  float bandHalf = mix(0.18, 0.42, uSaturation); // half-height of the lit band
  float distFromMid = abs(uv.y - 0.5);
  float band = 1.0 - smoothstep(bandHalf * 0.6, bandHalf, distFromMid);

  // ── Build the glow ─────────────────────────────────────────────────────────
  // Sharpen the noise into bright "veins" of current with a smoothstep contrast
  // curve, then gate by the band and the brightness/saturation uniforms.
  float veins = smoothstep(0.45, 0.85, field);
  float glow = veins * band;

  // Saturation also globally dims (deficit = starved look). Brightness is the
  // master throughput dial. Both come pre-composed for surge/burst upstream.
  glow *= uBrightness * mix(0.55, 1.0, uSaturation);

  // ── Color ramp: shadow color -> crest color along the glow intensity ───────
  vec3 col = mix(uColorA, uColorB, glow);

  // A faint additive core keeps bright veins from clipping to a flat tint and
  // gives the river a hot center line.
  col += uColorB * pow(glow, 3.0) * 0.6;

  // ── Dial-up-era warm CRT hint (rendering doc §8) ──────────────────────────
  // Very subtle horizontal scanlines tied to pixel height — a *hint*, not a
  // retro gimmick. 2px-ish period, ~4% modulation so it never dominates.
  float scan = 0.96 + 0.04 * sin(uv.y * uResolution.y * 3.14159);
  col *= scan;

  // Premultiply-friendly: alpha tracks glow so the band fades to fully
  // transparent at the edges, letting Layers 2/3 and the bg read through.
  float alpha = clamp(glow * 1.2, 0.0, 1.0);

  gl_FragColor = vec4(col * alpha, alpha);
}
